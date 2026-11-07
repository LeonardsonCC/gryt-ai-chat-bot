import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexAppServer } from '../src/providers/codex/app-server-client.js';

function server(t, handle = () => ({})) {
  const requests = [];
  const proc = new EventEmitter();
  proc.stdout = new PassThrough(); proc.exitCode = null; proc.signalCode = null;
  const emit = message => proc.stdout.write(`${JSON.stringify(message)}\n`);
  proc.stdin = new Writable({ write(chunk, encoding, callback) {
    const request = JSON.parse(chunk.toString()); requests.push(request);
    queueMicrotask(() => {
      if (request.id === undefined) return;
      let result;
      try {
        result = request.method === 'thread/start' ? { thread: { id: 'native-1', ephemeral: true } } : handle(request);
      } catch (error) { emit({ id: request.id, error: { message: error.message, code: error.code } }); return; }
      emit({ id: request.id, result });
      if (request.method === 'turn/start') {
        emit({ method: 'item/agentMessage/delta', params: { threadId: request.params.threadId, delta: 'Answer' } });
        emit({ method: 'turn/completed', params: { threadId: request.params.threadId, turn: { status: 'completed' } } });
      }
    }); callback();
  } });
  proc.kill = () => { proc.signalCode = 'SIGTERM'; queueMicrotask(() => proc.emit('exit', null)); };
  const client = new CodexAppServer({ model: 'default-model', timeoutMs: 1000, spawnProcess: () => proc });
  client.on('error', () => {});
  t.after(() => client.stop());
  return { client, requests };
}

test('Codex receives the whole transcript once and only the latest message on resume', async t => {
  const { client, requests } = server(t); await client.start();
  const session = await client.createSession({ model: 'chosen-model', instructions: 'Policy' });
  assert.equal(requests.find(r => r.method === 'thread/start').params.model, 'chosen-model');
  const messages = [{ role: 'system', content: 'Policy' }, { role: 'user', content: 'Previous question' }, { role: 'assistant', content: 'Previous answer' }, { role: 'user', content: 'Continue' }];
  const result = await client.reply({ session, messages });
  const first = requests.find(r => r.method === 'turn/start');
  assert.ok(first.params.input[0].text.includes('Previous answer'));
  assert.equal(first.params.model, 'chosen-model');
  assert.equal(result.session.historySeeded, true);
  await client.reply({ session: result.session, messages: [...messages, { role: 'assistant', content: result.text }, { role: 'user', content: 'Next' }] });
  const next = requests.filter(r => r.method === 'turn/start').at(-1).params.input[0].text;
  assert.ok(next.includes('Next'));
  assert.ok(!next.includes('Previous answer'));
  assert.ok(!next.includes('Continue'));
  assert.equal(requests.find(r => r.method === 'thread/start').params.ephemeral, true);
  const restarted = server(t); await restarted.client.start();
  await assert.rejects(restarted.client.reply({ session: result.session, messages }), { kind: 'invalid_session' });
});

test('Codex cleanup deletes expired active and archived native threads only', async t => {
  const { client, requests } = server(t, request => request.method === 'thread/list'
    ? { data: [{ id: request.params.archived ? 'old-archived' : 'old-active', createdAt: 100 }, { id: 'recent', createdAt: 999 }], nextCursor: null }
    : {});
  await client.start();
  await client.pruneHistory(500000);
  assert.deepEqual(requests.filter(r => r.method === 'thread/delete').map(r => r.params.threadId), ['old-active', 'old-archived']);
});

test('Codex releases an unused ephemeral session', async t => {
  const { client, requests } = server(t); await client.start();
  const session = await client.createSession({});
  await client.releaseSession(session);
  assert.ok(requests.some(r => r.method === 'thread/unsubscribe'));
});
