import { ProviderError } from '../../errors.js';

/** History-backed provider demonstrating the same small provider contract. */
export class OpenAIProvider {
  constructor({ model, apiKey = process.env.OPENAI_API_KEY, timeoutMs = 120000 } = {}) { this.model = model; this.apiKey = apiKey; this.timeoutMs = timeoutMs; }
  async start() { if (!this.apiKey) throw new ProviderError('authentication', 'OPENAI_API_KEY is required for the openai provider'); }
  async createSession({ model }) { return { id: crypto.randomUUID(), model }; }
  async reply({ session, messages, signal }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: session.model, instructions: messages.find(m => m.role === 'system')?.content, input: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })) }) });
      if (!response.ok) throw new ProviderError(response.status === 401 ? 'authentication' : response.status === 429 ? 'rate_limit' : response.status >= 500 ? 'unavailable' : 'unknown', `OpenAI request failed (${response.status})`, { uncertain: true });
      const result = await response.json();
      const text = result.output?.flatMap(item => item.content ?? []).find(item => item.type === 'output_text')?.text ?? '';
      if (!text) throw new ProviderError('unknown', 'OpenAI returned an empty reply', { uncertain: true });
      return { text, session, usage: result.usage };
    } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError(error.name === 'AbortError' ? 'timeout' : 'unavailable', error.message, { cause: error, uncertain: true }); }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
  async stop() {}
}
