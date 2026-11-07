import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationService } from '../src/application/conversation-service.js';
import { ThreadQueue } from '../src/application/thread-queue.js';
import { ConversationStore } from '../src/storage/conversation-store.js';
import { loadConfig } from '../src/config.js';

class FakeProvider {
  sessions = 0; calls = [];
  async start() {}
  async createSession(args) { this.sessions++; return { id: `session-${this.sessions}`, model: args.model }; }
  async reply(args) { this.calls.push(args); return { text: `reply ${this.calls.length}`, session: args.session }; }
  async stop() {}
}
class FakeTransport {
  mention = /@AI Chat\b/i; sent = []; started = []; typing() {} stopTyping() {}
  async startThread(message, title) { this.started.push({ message, title }); return { threadId: 'thread-new' }; }
  async send(message, threadId, text) { this.sent.push({ message, threadId, text }); }
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'gryt-test-'));
  const store = new ConversationStore(join(dir, 'conversations.json'), join(dir, 'conversations.bak'));
  await store.load();
  const transport = new FakeTransport(), provider = new FakeProvider(), providers = { get: () => provider };
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
  const store2 = new ConversationStore(f.store.path, f.store.backupPath); await store2.load();
  const transport2 = new FakeTransport(), provider2 = new FakeProvider();
  const service2 = new ConversationService({ transport: transport2, store: store2, providers: { get: () => provider2 }, providerName: 'openai', model: 'different-default', timeoutMs: 5000 });
  await service2.handle({ messageId: 'm2', conversationId: 'c', threadId: 'thread-old', text: 'continua' });
  assert.equal(provider2.sessions, 0);
  assert.equal(provider2.calls[0].session.id, 'session-1');
  assert.equal(store2.get('thread-old').model, 'gpt-6-luna');
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

test('configuration preserves Codex model default and validates provider', () => {
  assert.equal(loadConfig({}).model, 'gpt-6-luna');
  assert.equal(loadConfig({}).nickname, 'AI Chat');
  assert.equal(loadConfig({ ASSISTANT_MODEL: '' }).model, 'gpt-6-luna');
  assert.equal(loadConfig({ ASSISTANT_MODEL: 'gpt-6-spark' }).model, 'gpt-6-spark');
  assert.equal(loadConfig({ ASSISTANT_PROVIDER: 'openai' }).model, 'gpt-4.1-mini');
  assert.throws(() => loadConfig({ ASSISTANT_PROVIDER: 'missing' }), /Unsupported/);
});

test('legacy map is backed up and migrated atomically; concurrent writes are serialized', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'gryt-migrate-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'conversations.json'), backup = join(dir, 'conversations.json.bak');
  await writeFile(path, JSON.stringify({ one: 'codex-1', two: 'codex-2' }));
  const store = new ConversationStore(path, backup); await store.load();
  assert.equal(JSON.parse(await readFile(backup, 'utf8')).one, 'codex-1');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).version, 1);
  await Promise.all(['three', 'four', 'five'].map(gryThreadId => store.set({ id: gryThreadId, gryThreadId, provider: 'openai', model: 'm', session: {}, history: [] })));
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.conversations.length, 5);
});
