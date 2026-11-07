import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OpenRouterProvider } from '../src/providers/openrouter/provider.js';
import { loadConfig } from '../src/config.js';

const apiKey = 'test-key';
const session = { id: 'session-1', model: 'openrouter/free' };
const messages = [{ role: 'system', content: 'Instructions' }, { role: 'user', content: 'Hello' }];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('OpenRouter configuration keeps provider defaults and explicit overrides', () => {
  assert.equal(loadConfig({ ASSISTANT_PROVIDER: 'openrouter' }).model, 'openrouter/free');
  assert.equal(loadConfig({ ASSISTANT_PROVIDER: 'openrouter', ASSISTANT_MODEL: 'custom:free' }).model, 'custom:free');
  assert.equal(loadConfig({ ASSISTANT_PROVIDER: 'codex', ASSISTANT_MODEL: '' }).model, 'gpt-6-luna');
  const example = Object.fromEntries(readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
    .split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(/=(.*)/s).slice(0, 2)));
  assert.equal(loadConfig(example).model, 'gpt-6-luna');
  assert.equal(loadConfig({ ...example, ASSISTANT_PROVIDER: 'openrouter', ASSISTANT_MODEL: '' }).model, 'openrouter/free');
});

test('OpenRouter rejects blank credentials', async () => {
  await assert.rejects(new OpenRouterProvider({ apiKey: '   ' }).start(), { kind: 'authentication' });
});

test('OpenRouter sends the persisted model and history and preserves session and usage', async t => {
  const usage = { total_tokens: 12 };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { model: session.model, messages });
    return json({ choices: [{ message: { content: 'Hello!' } }], usage });
  });
  const result = await new OpenRouterProvider({ apiKey }).reply({ session, messages });
  assert.equal(result.text, 'Hello!');
  assert.equal(result.session, session);
  assert.deepEqual(result.usage, usage);
});

test('OpenRouter distinguishes authentication, budgets, policy, timeouts and outages', async t => {
  const cases = [
    [401, {}, 'authentication'],
    [402, {}, 'rate_limit'],
    [403, { metadata: { scope: 'key_limit' } }, 'rate_limit'],
    [403, { message: 'Key limit exceeded (total limit)' }, 'rate_limit'],
    [403, { message: 'Policy blocked this request' }, 'unknown'],
    [429, {}, 'rate_limit'],
    [408, {}, 'timeout'],
    [503, {}, 'unavailable'],
    [200, { code: 429 }, 'rate_limit'],
  ];
  const fetchMock = t.mock.method(globalThis, 'fetch');
  for (const [status, error, kind] of cases) {
    fetchMock.mock.mockImplementation(async () => json({ error }, status));
    await assert.rejects(new OpenRouterProvider({ apiKey }).reply({ session, messages }), { kind });
  }
});

test('OpenRouter handles malformed responses and does not expose credentials in errors', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('not JSON', { status: 503 }));
  const provider = new OpenRouterProvider({ apiKey });
  await assert.rejects(provider.reply({ session, messages }), { kind: 'unavailable' });
  for (const body of [null, {}, { choices: [{ message: { content: '   ' } }] }]) {
    fetchMock.mock.mockImplementation(async () => json(body));
    await assert.rejects(provider.reply({ session, messages }), { kind: 'unknown' });
  }
  fetchMock.mock.mockImplementation(async () => json({ error: { message: `Invalid ${apiKey}` } }, 401));
  await assert.rejects(provider.reply({ session, messages }), error => {
    assert.equal(error.kind, 'authentication');
    assert.ok(!error.message.includes(apiKey));
    return true;
  });
});

test('OpenRouter never sends an already cancelled request', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not send'); });
  await assert.rejects(new OpenRouterProvider({ apiKey }).reply({ session, messages, signal: AbortSignal.abort() }), { kind: 'timeout' });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('OpenRouter aborts in-flight requests on cancellation and timeout', async t => {
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const reply = new OpenRouterProvider({ apiKey }).reply({ session, messages, signal: controller.signal });
  controller.abort();
  await assert.rejects(reply, { kind: 'timeout' });
  await assert.rejects(new OpenRouterProvider({ apiKey, timeoutMs: 5 }).reply({ session, messages }), { kind: 'timeout' });
});
