import { resolve } from 'node:path';

const positiveInteger = (value, fallback, name) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
};

export function loadConfig(env = process.env) {
  const provider = env.ASSISTANT_PROVIDER?.trim() || 'codex';
  if (!['codex', 'openai'].includes(provider)) throw new Error(`Unsupported ASSISTANT_PROVIDER: ${provider}`);
  const nickname = env.GRYT_NICKNAME ?? 'AI Chat';
  return Object.freeze({
    grytHost: env.GRYT_HOST?.trim() || 'localhost:5000', nickname,
    mention: new RegExp(`@${nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
    identityPath: resolve(env.GRYT_IDENTITY_PATH?.trim() || '/data/gryt-bot-identity.json'),
    statePath: resolve(env.GRYT_STATE_PATH?.trim() || '/data/conversations.json'),
    backupPath: resolve(env.CONVERSATION_BACKUP_PATH?.trim() || '/data/conversations.json.bak'),
    provider, model: env.ASSISTANT_MODEL?.trim() || (provider === 'codex' ? env.CODEX_MODEL?.trim() || 'gpt-6-luna' : 'gpt-4.1-mini'),
    cwd: env.CODEX_CWD?.trim() || '/tmp/gryt-ai-chat-bot',
    timeoutMs: positiveInteger(env.PROVIDER_TIMEOUT_MS, 120000, 'PROVIDER_TIMEOUT_MS'),
    shutdownMs: positiveInteger(env.SHUTDOWN_TIMEOUT_MS, 10000, 'SHUTDOWN_TIMEOUT_MS'),
  });
}
