import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, utimes, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConversationStore } from '../src/storage/conversation-store.js';
import { readThreadHistory } from '../src/transports/thread-history.js';

const mention = /@AI Chat\b/i;

test('cache is disabled by default and removes existing local copies without touching credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'history-disabled-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'conversations.json'), backup = `${path}.bak`, credentials = join(dir, 'auth.json');
  await writeFile(path, 'old transcript');
  await writeFile(backup, 'old backup');
  await writeFile(credentials, 'keep credentials');
  const store = new ConversationStore(path, backup);
  await store.load();
  await store.set({ gryThreadId: 'thread', history: [{ content: 'new transcript' }] });
  await store.prune();
  assert.equal(store.get('thread'), undefined);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
  await assert.rejects(readFile(backup), { code: 'ENOENT' });
  assert.equal(await readFile(credentials, 'utf8'), 'keep credentials');
});

test('cache expiry is fixed, persists across restarts and removes transcript bytes from disk', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'history-ttl-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'conversations.json'); let clock = 1000;
  const options = { enabled: true, ttlMs: 100, now: () => clock };
  const store = new ConversationStore(path, join(dir, 'old.bak'), options); await store.load();
  await store.set({ gryThreadId: 't', history: [{ role: 'user', content: 'private-message' }] });
  clock = 1090;
  await store.set({ ...store.get('t'), model: 'another-model' });
  const restored = new ConversationStore(path, join(dir, 'old.bak'), options); await restored.load();
  assert.equal(restored.get('t').expiresAt, 1100);
  clock = 1100;
  assert.equal(restored.get('t'), undefined);
  await restored.prune();
  assert.ok(!(await readFile(path, 'utf8')).includes('private-message'));
});

test('replacing an expired cache releases its old native session', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'history-release-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let clock = 1000;
  const released = [];
  const store = new ConversationStore(join(dir, 'conversations.json'), undefined, { enabled: true, ttlMs: 100, now: () => clock, onExpire: async row => released.push(row.session.id) });
  await store.load();
  await store.set({ gryThreadId: 'thread', history: [], session: { id: 'old' } });
  clock = 1101;
  await store.set({ gryThreadId: 'thread', history: [], session: { id: 'new' } });
  assert.deepEqual(released, ['old']);
  assert.equal(store.get('thread').session.id, 'new');
});

test('cleanup expires backup files and honors a shorter configured TTL', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'history-backup-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'conversations.json'), backup = `${path}.pre-free-model.bak`;
  await writeFile(backup, 'old-transcript'); await utimes(backup, new Date(0), new Date(0));
  await writeFile(path, JSON.stringify({ version: 3, conversations: [{ gryThreadId: 't', cachedAt: 1000, expiresAt: 2000, history: [] }] }));
  const store = new ConversationStore(path, backup, { enabled: true, ttlMs: 100, now: () => 1200 }); await store.load();
  assert.equal(store.get('t'), undefined);
  await assert.rejects(readFile(backup), { code: 'ENOENT' });
});

test('thread recovery paginates, deduplicates and excludes the triggering message and later messages', async () => {
  const row = (messageId, text, time, isOwn = false) => ({ messageId, text, createdAt: new Date(time), isOwn, senderNickname: 'Ana' });
  const root = row('root', '@AI Chat remember', 1);
  const first = row('first', 'Remembered', 2, true);
  const second = row('second', 'Continue', 3);
  const current = row('current', 'Current', 4);
  const later = row('later', 'Later', 5);
  let calls = 0;
  const bot = { thread: async (conversationId, threadId, opts) => {
    calls++;
    if (!opts.before) return { thread: {}, root, replies: [second, current, later], hasMore: true };
    assert.equal(opts.before, second.createdAt.toISOString());
    return { thread: {}, root, replies: [first, second], hasMore: false };
  } };
  const result = await readThreadHistory(bot, mention, { ...current, conversationId: 'channel' }, 'thread');
  assert.equal(calls, 2);
  assert.equal(result.addressed, true);
  assert.deepEqual(result.history, [{ role: 'user', content: 'Ana: remember' }, { role: 'assistant', content: 'Remembered' }, { role: 'user', content: 'Ana: Continue' }]);
});

test('thread recovery detects unrelated threads and rejects broken pagination', async () => {
  const row = { messageId: 'old', createdAt: new Date(1), text: 'ordinary conversation' };
  const bot = { thread: async () => ({ thread: {}, root: row, replies: [row], hasMore: false }) };
  assert.equal((await readThreadHistory(bot, mention, { messageId: 'current' }, 't')).addressed, false);
  bot.thread = async () => ({ thread: {}, replies: [row], hasMore: true });
  await assert.rejects(readThreadHistory(bot, mention, { messageId: 'current' }, 't'), /did not advance/);
});
