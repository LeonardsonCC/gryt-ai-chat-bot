import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationService } from '../src/application/conversation-service.js';
import { ThreadQueue } from '../src/application/thread-queue.js';
import { ConversationStore } from '../src/storage/conversation-store.js';
import { ProviderError } from '../src/errors.js';
import { loadConfig } from '../src/config.js';
import { ProviderRegistry } from '../src/providers/registry.js';

class FakeProvider {
  sessions = 0; calls = [];
  async start() {}
  async createSession(args) { this.sessions++; return { id: `session-${this.sessions}`, model: args.model }; }
  async reply(args) { this.calls.push(args); return { text: `reply ${this.calls.length}`, session: args.session }; }
  async stop() {}
}
class FakeTransport {
  mention = /@AI Chat\b/i; sent = []; started = []; typing() {} stopTyping() {}
  async readThread() { return { history: [], addressed: false }; }
  async startThread(message, title) { this.started.push({ message, title }); return { threadId: 'thread-new' }; }
  async send(message, threadId, text) { this.sent.push({ message, threadId, text }); }
}
async function fixture({ cacheEnabled = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gryt-test-'));
  const store = new ConversationStore(join(dir, 'conversations.json'), join(dir, 'conversations.bak'), { enabled: cacheEnabled });
  await store.load();
  const transport = new FakeTransport(), provider = new FakeProvider(), providers = new ProviderRegistry({ codex: provider, openai: provider, openrouter: provider });
  const service = new ConversationService({ transport, store, providers, providerName: 'codex', model: 'gpt-6-luna', timeoutMs: 5000 });
  return { dir, store, transport, provider, service };
}

test('channel mention opens a Gryt thread and creates one provider session', async t => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  await f.service.handle({ messageId: 'm1', conversationId: 'c', text: '@AI Chat Olá', senderNickname: 'Ana' });
  assert.equal(f.transport.started.length, 1);
  assert.equal(f.transport.sent[0].threadId, 'thread-new');
  assert.equal(f.provider.sessions, 1);
  assert.match(f.provider.calls[0].messages[0].content, /Você é AI Chat/);
});

test('mention adopts an existing thread; following replies keep using its session', async t => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  await f.service.handle({ messageId: 'm1', conversationId: 'c', threadId: 'thread-old', text: '@AI Chat continue', senderNickname: 'Ana' });
  await f.service.handle({ messageId: 'm2', conversationId: 'c', threadId: 'thread-old', text: 'mais uma pergunta', senderNickname: 'Ana' });
  assert.equal(f.transport.started.length, 0);
  assert.equal(f.provider.sessions, 1);
  assert.equal(f.provider.calls.length, 2);
  assert.deepEqual(f.provider.calls[1].session, { id: 'session-1', model: 'gpt-6-luna' });
});

test('saved conversation resumes after process restart', async t => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  await f.service.handle({ messageId: 'm1', conversationId: 'c', threadId: 'thread-old', text: '@AI Chat oi' });
  const store2 = new ConversationStore(f.store.path, f.store.backupPath, { enabled: true }); await store2.load();
  const transport2 = new FakeTransport(), provider2 = new FakeProvider();
  const service2 = new ConversationService({ transport: transport2, store: store2, providers: new ProviderRegistry({ codex: provider2, openai: provider2 }), providerName: 'openai', model: 'different-default', timeoutMs: 5000 });
  await service2.handle({ messageId: 'm2', conversationId: 'c', threadId: 'thread-old', text: 'continua' });
  assert.equal(provider2.sessions, 1);
  assert.equal(provider2.calls[0].session.id, 'session-1');
  assert.equal(store2.get('thread-old').provider, 'openai');
  assert.equal(store2.get('thread-old').model, 'different-default');
  assert.equal(provider2.calls[0].messages.length, 4);
});

test('per-thread queue serializes same thread while allowing distinct threads in parallel', async () => {
  const queue = new ThreadQueue(), seen = [];
  let release; const gate = new Promise(resolve => { release = resolve; });
  const first = queue.enqueue('a', async () => { seen.push('a1'); await gate; seen.push('a1done'); });
  const second = queue.enqueue('a', async () => seen.push('a2'));
  await queue.enqueue('b', async () => seen.push('b1'));
  assert.deepEqual(seen, ['a1', 'b1']); release(); await Promise.all([first, second]);
  assert.deepEqual(seen, ['a1', 'b1', 'a1done', 'a2']);
});

test('OpenRouter history survives restart with a compatible session', async t => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  f.service.providerName = 'openrouter'; f.service.model = 'openrouter/free';
  await f.service.handle({ messageId: 'm1', threadId: 'thread-free', text: '@AI Chat oi' });
  const store = new ConversationStore(f.store.path, f.store.backupPath, { enabled: true }); await store.load();
  const provider = new FakeProvider();
  const service = new ConversationService({ transport: f.transport, store, providers: new ProviderRegistry({ openrouter: provider }), providerName: 'openrouter', model: 'openrouter/free', timeoutMs: 5000 });
  await service.handle({ messageId: 'm2', threadId: 'thread-free', text: 'continua' });
  assert.equal(provider.sessions, 0);
  assert.equal(provider.calls[0].session.model, 'openrouter/free');
  assert.deepEqual(provider.calls[0].messages.slice(1, 3), store.get('thread-free').history.slice(0, 2));
  assert.equal(store.get('thread-free').history.length, 4);
});

test('configuration preserves Codex model default and validates provider', () => {
  assert.equal(loadConfig({}).historyCacheEnabled, false);
  assert.equal(loadConfig({ HISTORY_CACHE_ENABLED: 'true', HISTORY_TTL_HOURS: '24' }).historyCacheEnabled, true);
  assert.equal(loadConfig({ HISTORY_TTL_HOURS: '24' }).historyTtlMs, 86400000);
  assert.throws(() => loadConfig({ HISTORY_CACHE_ENABLED: 'maybe' }), /must be true or false/);
  assert.throws(() => loadConfig({ HISTORY_TTL_HOURS: '0' }), /positive integer/);
  assert.equal(loadConfig({}).model, 'gpt-6-luna');
  assert.equal(loadConfig({}).nickname, 'AI Chat');
  assert.equal(loadConfig({ ASSISTANT_MODEL: '' }).model, 'gpt-6-luna');
  assert.equal(loadConfig({ ASSISTANT_MODEL: 'gpt-6-spark' }).model, 'gpt-6-spark');
  assert.equal(loadConfig({ ASSISTANT_PROVIDER: 'openai' }).model, 'gpt-4.1-mini');
  assert.equal(loadConfig({ CODEX_MODEL: 'legacy-model' }).model, 'legacy-model');
  assert.equal(loadConfig({ CODEX_MODEL: 'legacy-model', ASSISTANT_MODEL: 'chosen-model' }).model, 'chosen-model');
  assert.equal(loadConfig({ ASSISTANT_PROVIDER: 'openrouter', CODEX_MODEL: 'legacy-model' }).model, 'openrouter/free');
  assert.throws(() => loadConfig({ ASSISTANT_PROVIDER: 'missing' }), /Unsupported/);
});

test('disabled cache reloads the entire thread every reply and never reuses a session or writes history', async t => {
  const f = await fixture({ cacheEnabled: false }); t.after(() => rm(f.dir, { recursive: true, force: true }));
  let reads = 0;
  const released = [];
  f.provider.releaseSession = async session => released.push(session.id);
  f.transport.readThread = async () => ({ addressed: true, history: [{ role: 'user', content: ++reads === 1 ? 'old text' : 'edited text' }] });
  await f.service.handle({ messageId: 'first', threadId: 'thread', text: 'hello' });
  await f.service.handle({ messageId: 'next', threadId: 'thread', text: 'continue' });
  assert.equal(reads, 2);
  assert.equal(f.provider.sessions, 2);
  assert.equal(f.provider.calls[1].messages[1].content, 'edited text');
  assert.ok(!JSON.stringify(f.provider.calls[1].messages).includes('old text'));
  assert.deepEqual(released, ['session-1', 'session-2']);
  assert.equal(f.store.get('thread'), undefined);
  await assert.rejects(readFile(f.store.path), { code: 'ENOENT' });
});

test('enabled cache reuses history until its TTL expires, then rereads Gryt', async t => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  let clock = Date.now(), reads = 0;
  f.store.now = () => clock; f.store.ttlMs = 100;
  f.transport.readThread = async () => ({ addressed: true, history: [{ role: 'user', content: `snapshot-${++reads}` }] });
  await f.service.handle({ messageId: 'first', threadId: 'thread', text: 'hello' });
  await f.service.handle({ messageId: 'next', threadId: 'thread', text: 'continue' });
  assert.equal(reads, 1);
  clock += 101;
  await f.service.handle({ messageId: 'last', threadId: 'thread', text: 'continue' });
  assert.equal(reads, 2);
  assert.equal(f.provider.calls[2].messages[1].content, 'snapshot-2');
});

test('all providers can take over the same thread and keep the full transcript', async t => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  const codex = new FakeProvider(), openai = new FakeProvider(), openrouter = new FakeProvider();
  f.service.providers = new ProviderRegistry({ codex, openai, openrouter });
  const sequence = [codex, openrouter, openai, codex];
  for (const [index, name] of ['codex', 'openrouter', 'openai', 'codex'].entries()) {
    f.service.providerName = name; f.service.model = `${name}-model`;
    await f.service.handle({ messageId: `m${index}`, threadId: 'shared-thread', text: index ? 'continue' : '@AI Chat hello' });
    const call = sequence[index].calls.at(-1);
    assert.equal(call.messages.length, 2 + index * 2);
    assert.equal(call.session.model, `${name}-model`);
    assert.equal(f.store.get('shared-thread').history.length, (index + 1) * 2);
  }
  assert.equal(codex.sessions, 2);
});

test('changing only the model replaces the session and retains history', async t => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  await f.service.handle({ messageId: 'm1', threadId: 'thread', text: '@AI Chat hello' });
  f.service.model = 'new-model';
  await f.service.handle({ messageId: 'm2', threadId: 'thread', text: 'continue' });
  assert.equal(f.provider.sessions, 2);
  assert.equal(f.provider.calls[1].session.model, 'new-model');
  assert.equal(f.provider.calls[1].messages.length, 4);
});

test('missing cache rereads the Gryt thread without requiring a new mention', async t => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  const history = [{ role: 'user', content: 'Ana: remember me' }, { role: 'assistant', content: 'Remembered' }];
  f.transport.readThread = async () => ({ history, addressed: true });
  await f.service.handle({ messageId: 'next', threadId: 'existing', text: 'continue' });
  assert.deepEqual(f.provider.calls[0].messages.slice(1, 3), history);
});

test('unrelated threads do not receive replies after a cache miss', async t => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  await f.service.handle({ messageId: 'next', threadId: 'other', text: 'hello' });
  assert.equal(f.provider.calls.length, 0);
  assert.equal(f.transport.sent.length, 0);
});

test('a lost native session is recreated from the shared transcript', async t => {
  const f = await fixture(); t.after(() => rm(f.dir, { recursive: true, force: true }));
  await f.service.handle({ messageId: 'first', threadId: 'thread', text: '@AI Chat remember' });
  const reply = f.provider.reply.bind(f.provider);
  let failed = false;
  f.provider.reply = args => { if (!failed) { failed = true; throw new ProviderError('invalid_session', 'gone'); } return reply(args); };
  await f.service.handle({ messageId: 'next', threadId: 'thread', text: 'continue' });
  assert.equal(f.provider.sessions, 2);
  assert.equal(f.provider.calls[1].messages.length, 4);
});

test('undated legacy cache is discarded; concurrent writes are serialized', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gryt-migrate-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'conversations.json'), backup = join(dir, 'conversations.json.bak');
  await writeFile(path, JSON.stringify({ one: 'codex-1', two: 'codex-2' }));
  const store = new ConversationStore(path, backup, { enabled: true }); await store.load();
  assert.equal(store.get('one'), undefined);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).version, 3);
  await Promise.all(['three', 'four', 'five'].map(gryThreadId => store.set({ id: gryThreadId, gryThreadId, provider: 'openai', model: 'm', session: {}, history: [] })));
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.conversations.length, 3);
});
