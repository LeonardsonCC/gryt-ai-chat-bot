import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.js';
import { ConversationService } from './application/conversation-service.js';
import { ThreadQueue } from './application/thread-queue.js';
import { GrytTransport } from './transports/gryt.js';
import { ProviderRegistry } from './providers/registry.js';
import { CodexProvider } from './providers/codex/provider.js';
import { OpenAIProvider } from './providers/openai/provider.js';
import { ConversationStore } from './storage/conversation-store.js';

const config = loadConfig();
const transport = new GrytTransport(config);
const providers = new ProviderRegistry({ codex: new CodexProvider(config), openai: new OpenAIProvider({ model: config.model, timeoutMs: config.timeoutMs }) });
const store = new ConversationStore(config.statePath, config.backupPath);
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

await store.load();
await providers.get(config.provider).start();
transport.start().catch(error => console.error('[gryt] start failed:', error.message));

let stopping;
async function shutdown() {
  if (stopping) return stopping;
  accepting = false;
  stopping = (async () => {
    await transport.stop().catch(error => console.error('[gryt] stop failed:', error.message));
    await queue.drain();
    await Promise.allSettled([...new Set(['codex', 'openai'])].map(name => providers.get(name).stop()));
  })();
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown().finally(() => process.exit(0)); });
