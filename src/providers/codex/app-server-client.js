import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { ProviderError } from '../../errors.js';

/** Minimal JSON-RPC client for Codex app-server stdio. */
export class CodexAppServer extends EventEmitter {
  #proc; #nextId = 1; #pending = new Map(); #turns = new Map(); #loaded = new Set(); #ready;
  constructor({ cwd, model, timeoutMs = 120000 } = {}) { super(); this.cwd = cwd; this.model = model; this.timeoutMs = timeoutMs; }
  async start() {
    try { this.#proc = spawn('codex', ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env }); }
    catch (error) { throw new ProviderError('unavailable', 'Could not start Codex app-server', { cause: error }); }
    this.#proc.on('error', error => this.#failAll(new ProviderError('unavailable', 'Codex app-server failed to start', { cause: error })));
    createInterface({ input: this.#proc.stdout }).on('line', line => this.#onLine(line));
    this.#proc.on('exit', code => this.#failAll(new ProviderError('unavailable', `Codex app-server exited (${code ?? 'signal'})`, { uncertain: true })));
    try {
      await this.#request('initialize', { clientInfo: { name: 'gryt_ai_chat_bot', title: 'Gryt AI Chat Bot', version: '0.2.0' }, capabilities: { experimentalApi: true } });
      this.#write({ method: 'initialized', params: {} });
    } catch (error) { await this.stop(); throw error; }
  }
  #write(value) { if (!this.#proc?.stdin.writable) throw new ProviderError('unavailable', 'Codex app-server stdin is closed'); this.#proc.stdin.write(`${JSON.stringify(value)}\n`); }
  #request(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new ProviderError('timeout', `Codex request timed out: ${method}`, { uncertain: true })); }, this.timeoutMs);
      this.#pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      try { this.#write({ method, id, params }); } catch (error) { this.#pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  #onLine(line) {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && this.#pending.has(msg.id)) { const p = this.#pending.get(msg.id); this.#pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message ?? 'Codex request failed')) : p.resolve(msg.result); return; }
    if (msg.method === 'item/agentMessage/delta') { const t = this.#turns.get(msg.params?.threadId); if (t) t.text += msg.params?.delta ?? ''; }
    else if (msg.method === 'turn/completed') { const { threadId, turn } = msg.params ?? {}; const p = this.#turns.get(threadId); if (p) { this.#turns.delete(threadId); turn?.status === 'completed' ? p.resolve(p.text.trim()) : p.reject(new Error(turn?.error?.message ?? `Codex turn ${turn?.status ?? 'failed'}`)); } }
    else if (msg.method === 'error') this.emit('error', new Error(msg.params?.message ?? 'Codex app-server error'));
  }
  #failAll(error) { for (const p of this.#pending.values()) p.reject(error); for (const p of this.#turns.values()) p.reject(error); this.#pending.clear(); this.#turns.clear(); this.emit('error', error); }
  async createSession({ instructions } = {}) { const result = await this.#request('thread/start', { model: this.model, cwd: this.cwd, approvalPolicy: 'never', permissions: 'gryt_chat', serviceName: 'gryt_ai_chat_bot' }); this.#loaded.add(result.thread.id); return { threadId: result.thread.id, instructions }; }
  async #resume(session) { if (this.#loaded.has(session.threadId)) return; try { await this.#request('thread/resume', { threadId: session.threadId, excludeTurns: true }); this.#loaded.add(session.threadId); } catch (error) { throw new ProviderError('invalid_session', error.message, { cause: error }); } }
  async reply({ session, messages, signal }) {
    await this.#resume(session);
    if (signal?.aborted) throw new ProviderError('timeout', 'Reply cancelled');
    const instructions = messages.find(m => m.role === 'system')?.content ?? session.instructions ?? '';
    const text = `${instructions}\n\n${messages.filter(m => m.role !== 'system').map(m => `${m.role === 'assistant' ? 'Codex' : 'Usuário'}: ${m.content}`).join('\n')}`;
    const threadId = session.threadId;
    if (this.#turns.has(threadId)) throw new Error('A reply is already being generated for this thread');
    const turn = { text: '' };
    const completed = new Promise((resolve, reject) => { turn.resolve = resolve; turn.reject = reject; });
    this.#turns.set(threadId, turn);
    const abort = () => { this.#turns.delete(threadId); turn.reject(new ProviderError('timeout', 'Reply cancelled', { uncertain: true })); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, this.timeoutMs);
    try { await this.#request('turn/start', { threadId, input: [{ type: 'text', text }], cwd: this.cwd, approvalPolicy: 'never', model: this.model, effort: 'medium' }); const response = await completed; return { text: response, session }; }
    catch (error) { throw error; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.#turns.delete(threadId); }
  }
  async stop() {
    if (!this.#proc) return;
    const proc = this.#proc; this.#proc = undefined;
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    try { proc.stdin.end(); proc.kill('SIGTERM'); } catch { return; }
    await Promise.race([
      new Promise(resolve => proc.once('exit', resolve)),
      new Promise(resolve => setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve(); }, 5000)),
    ]);
  }
}
