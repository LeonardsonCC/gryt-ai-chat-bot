import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { ConversationService } from './application/conversation-service.js';
import { ThreadQueue } from './application/thread-queue.js';
import { GrytTransport } from './transports/gryt.js';
import { ProviderRegistry } from './providers/registry.js';
import { CodexProvider } from './providers/codex/provider.js';
import { OpenAIProvider } from './providers/openai/provider.js';
import { OpenRouterProvider } from './providers/openrouter/provider.js';
import { ConversationStore } from './storage/conversation-store.js';

const config = loadConfig();
const transport = new GrytTransport(config);
const providers = new ProviderRegistry({ codex: new CodexProvider(config), openai: new OpenAIProvider({ model: config.model, timeoutMs: config.timeoutMs }), openrouter: new OpenRouterProvider({ timeoutMs: config.timeoutMs }) });
const store = new ConversationStore(config.statePath, config.backupPath, {
  enabled: config.historyCacheEnabled,
  ttlMs: config.historyTtlMs,
  onExpire: record => providers.get(record.provider).releaseSession?.(record.session),
});
const service = new ConversationService({ transport, store, providers, providerName: config.provider, model: config.model, timeoutMs: config.timeoutMs });
const queue = new ThreadQueue();
let accepting = true;
let avatarApplied = false;

async function applyAvatar(info) {
  if (avatarApplied || !info.permissions.includes('upload_avatar_image')) return;
  try { await transport.bot.setAvatar(await readFile('/app/avatar.png'), 'codex-avatar.png', 'image/png'); avatarApplied = true; } catch (error) { console.error('[gryt] avatar update failed:', error.message); }
}

transport.on('message', message => {
  if (!accepting) return;
  if (message.isSystem || !message.text?.trim()) return;
  const threadId = message.threadId ?? `root:${message.messageId}`;
  void queue.enqueue(threadId, () => service.handle(message)).catch(error => console.error('[conversation]', error.message));
});
transport.on('ready', info => { console.log(`[gryt] connected to ${info.name}; permissions: ${info.permissions.join(', ') || 'none'}.`); void applyAvatar(info); transport.bot.socket?.on('server:details', () => void applyAvatar({ permissions: transport.bot.permissions })); });
transport.on('waiting', message => { console.log(`[gryt] ${message}`); console.log('[gryt] aprove AI Chat em Server settings → Bots.'); });
transport.on('error', error => console.error('[gryt]', error.message));
providers.get(config.provider).on?.('error', error => console.error(`[${config.provider}]`, error.message));
if (config.provider !== 'codex') providers.get('codex').on('error', error => console.error('[codex]', error.message));

await store.load();
let cleaning;
function cleanup() {
  return cleaning ??= (async () => {
    await store.prune();
    await providers.start('codex');
    await providers.get('codex').pruneHistory(config.historyCacheEnabled ? Date.now() - config.historyTtlMs : Date.now());
  })().finally(() => { cleaning = undefined; });
}
await cleanup();
const cleanupTimer = setInterval(() => { void cleanup().catch(error => console.error('[history] cleanup failed:', error.message)); }, Math.min(config.historyTtlMs, 60000));
cleanupTimer.unref();
await providers.start(config.provider);
transport.start().catch(error => console.error('[gryt] start failed:', error.message));

let stopping;
async function shutdown() {
  if (stopping) return stopping;
  accepting = false;
  clearInterval(cleanupTimer);
  stopping = (async () => {
    await transport.stop().catch(error => console.error('[gryt] stop failed:', error.message));
    await queue.drain();
    await store.flush();
    await cleaning;
    await providers.stop();
  })();
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown().finally(() => process.exit(0)); });
