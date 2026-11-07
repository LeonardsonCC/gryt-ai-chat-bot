import { ProviderError } from '../../errors.js';

/** History-backed provider for OpenRouter's OpenAI-compatible chat completions API. */
export class OpenRouterProvider {
  constructor({ apiKey = process.env.OPENROUTER_API_KEY, timeoutMs = 120000 } = {}) {
    this.apiKey = apiKey?.trim();
    this.timeoutMs = timeoutMs;
  }
  async start() { if (!this.apiKey) throw new ProviderError('authentication', 'OPENROUTER_API_KEY is required for the openrouter provider'); }
  async createSession({ model }) { return { id: crypto.randomUUID(), model }; }
  async reply({ session, messages, signal }) {
    if (signal?.aborted) throw new ProviderError('timeout', 'OpenRouter reply cancelled');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: session.model, messages }),
      });
      const result = await response.json().catch(error => {
        if (controller.signal.aborted) throw error;
        return null;
      });
      if (!response.ok || result?.error) {
        const status = response.ok ? Number(result.error.code) || response.status : response.status;
        const rawDetail = result?.error?.message;
        const detail = typeof rawDetail === 'string'
          ? rawDetail.replaceAll(this.apiKey || '\u0000', '[REDACTED]').replace(/sk-or-v1-[a-zA-Z0-9_-]+/g, '[REDACTED]').slice(0, 500)
          : '';
        const isKeyLimit = result?.error?.metadata?.scope === 'key_limit' || /key limit exceeded/i.test(detail);
        const kind = status === 401 ? 'authentication'
          : status === 402 || status === 429 || isKeyLimit ? 'rate_limit'
            : status === 408 || status === 504 ? 'timeout'
              : status >= 500 ? 'unavailable' : 'unknown';
        throw new ProviderError(kind, `OpenRouter request failed (${status})${detail ? `: ${detail}` : ''}`, { uncertain: true });
      }
      const text = result?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new ProviderError('unknown', 'OpenRouter returned an empty reply', { uncertain: true });
      return { text, session, usage: result.usage };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(controller.signal.aborted ? 'timeout' : 'unavailable', controller.signal.aborted ? 'OpenRouter reply cancelled or timed out' : 'OpenRouter connection failed', { cause: error, uncertain: true });
    }
    finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
  async stop() {}
}
