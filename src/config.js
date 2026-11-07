import { resolve } from 'node:path';

const positiveInteger = (value, fallback, name) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
};
const boolean = (value, fallback, name) => {
  if (value == null || value.trim() === '') return fallback;
  if (value.trim().toLowerCase() === 'true') return true;
  if (value.trim().toLowerCase() === 'false') return false;
  throw new Error(`${name} must be true or false`);
};

export function loadConfig(env = process.env) {
  const provider = env.ASSISTANT_PROVIDER?.trim() || 'codex';
  if (!['codex', 'openai', 'openrouter'].includes(provider)) throw new Error(`Unsupported ASSISTANT_PROVIDER: ${provider}`);
  const nickname = env.GRYT_NICKNAME ?? 'AI Chat';
  // Legacy fallback for environments that still pass CODEX_MODEL directly to Node.
  const defaultModel = { codex: env.CODEX_MODEL?.trim() || 'gpt-6-luna', openai: 'gpt-4.1-mini', openrouter: 'openrouter/free' }[provider];
  return Object.freeze({
    grytHost: env.GRYT_HOST?.trim() || 'localhost:5000', nickname,
    mention: new RegExp(`@${nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
    identityPath: resolve(env.GRYT_IDENTITY_PATH?.trim() || '/data/gryt-bot-identity.json'),
    statePath: resolve(env.GRYT_STATE_PATH?.trim() || '/data/conversations.json'),
    backupPath: resolve(env.CONVERSATION_BACKUP_PATH?.trim() || '/data/conversations.json.bak'),
    provider, model: env.ASSISTANT_MODEL?.trim() || defaultModel,
    cwd: env.CODEX_CWD?.trim() || '/tmp/gryt-ai-chat-bot',
    timeoutMs: positiveInteger(env.PROVIDER_TIMEOUT_MS, 120000, 'PROVIDER_TIMEOUT_MS'),
    historyTtlMs: positiveInteger(env.HISTORY_TTL_HOURS, 168, 'HISTORY_TTL_HOURS') * 3600000,
    historyCacheEnabled: boolean(env.HISTORY_CACHE_ENABLED, false, 'HISTORY_CACHE_ENABLED'),
    shutdownMs: positiveInteger(env.SHUTDOWN_TIMEOUT_MS, 10000, 'SHUTDOWN_TIMEOUT_MS'),
  });
}
