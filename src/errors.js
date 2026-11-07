/** @typedef {'authentication'|'rate_limit'|'unavailable'|'invalid_session'|'timeout'|'unknown'} ErrorKind */
export class ProviderError extends Error {
  /** @param {ErrorKind} kind @param {string} message @param {{ cause?: unknown, uncertain?: boolean }} [options] */
  constructor(kind, message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.kind = kind;
    this.uncertain = options.uncertain ?? false;
  }
}

export function normalizeProviderError(error) {
  if (error instanceof ProviderError) return error;
  const message = String(error?.message ?? error);
  const kind = /auth|login|sign.?in|unauthorized|\b401\b/i.test(message) ? 'authentication'
    : /rate.?limit|quota|\b429\b/i.test(message) ? 'rate_limit'
      : /session.*(invalid|not found)|thread.*not found/i.test(message) ? 'invalid_session'
        : /timeout|timed out|\babort/i.test(message) ? 'timeout'
          : /unavailable|connection|exited|\b5\d\d\b/i.test(message) ? 'unavailable' : 'unknown';
  return new ProviderError(kind, message, { cause: error, uncertain: true });
}
