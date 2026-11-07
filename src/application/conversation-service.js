import { ASSISTANT_INSTRUCTIONS, userMessage } from './prompt-policy.js';
import { normalizeProviderError } from '../errors.js';

export class ConversationService {
  constructor({ transport, store, providers, providerName, model, timeoutMs }) { Object.assign(this, { transport, store, providers, providerName, model, timeoutMs }); }
  async handle(message) {
    if (message.isSystem || !message.text?.trim()) return;
    const text = message.text.trim();
    let gryThreadId = message.threadId;
    const mentionText = text.replace(this.transport.mention, '').trim();
    if (!gryThreadId && !this.transport.mention.test(text)) return;
    if (!gryThreadId) gryThreadId = (await this.transport.startThread(message, mentionText.slice(0, 100) || 'Conversa com AI Chat')).threadId;
    let record = this.store.get(gryThreadId);
    const providerName = this.providerName;
    const model = this.model;
    const provider = this.providers.get(providerName);
    try {
      if (!record) {
        let recovered;
        try { recovered = message.threadId ? await this.transport.readThread(message, gryThreadId) : { history: [], addressed: true }; }
        catch (error) {
          if (this.transport.mention.test(text)) throw error;
          console.error('[history] thread recovery failed:', error.message);
          return;
        }
        if (!this.transport.mention.test(text) && !recovered.addressed) return;
        record = { id: crypto.randomUUID(), gryThreadId, history: recovered.history, historyVersion: 1 };
      }
      await this.providers.start(providerName);
      if (!record.session || record.provider !== providerName || record.model !== model) {
        const session = await provider.createSession({ model, instructions: ASSISTANT_INSTRUCTIONS });
        if (record.session) await this.providers.get(record.provider).releaseSession?.(record.session);
        record.session = session;
      }
      Object.assign(record, { provider: providerName, model, historyVersion: 1 });
      record = await this.store.set(record);
      const question = mentionText || (message.threadId ? text : 'Olá!');
      const messages = [{ role: 'system', content: ASSISTANT_INSTRUCTIONS }, ...record.history, userMessage(message, question)];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      this.transport.typing(message, gryThreadId);
      try {
        let result;
        try { result = await provider.reply({ session: record.session, messages, signal: controller.signal }); }
        catch (error) {
          if (normalizeProviderError(error).kind !== 'invalid_session' || controller.signal.aborted) throw error;
          record.session = await provider.createSession({ model, instructions: ASSISTANT_INSTRUCTIONS });
          result = await provider.reply({ session: record.session, messages, signal: controller.signal });
        }
        if (!result?.text?.trim()) throw new Error('Provider returned an empty reply');
        record.session = result.session ?? record.session;
        record.history = [...record.history, userMessage(message, question), { role: 'assistant', content: result.text }];
        await this.store.set(record);
        await this.transport.send(message, gryThreadId, result.text);
      } finally { clearTimeout(timeout); this.transport.stopTyping(message, gryThreadId); }
    } catch (error) {
      const normalized = normalizeProviderError(error);
      console.error(`[${providerName}] reply failed (${normalized.kind}):`, normalized.message);
      const hints = { authentication: 'O provider ainda não está autenticado. Peça ao administrador para concluir a configuração.', rate_limit: 'O provider atingiu o limite de uso. Tente novamente mais tarde.', unavailable: 'O provider está temporariamente indisponível. Tente novamente em instantes.', invalid_session: 'Não consegui retomar esta conversa. Peça ao administrador para verificar a sessão.', timeout: 'A resposta demorou demais. Tente novamente mais tarde.', unknown: 'Não consegui gerar uma resposta agora. Tente novamente em instantes.' };
      await this.transport.send(message, gryThreadId, hints[normalized.kind]).catch(sendError => console.error('[gryt] error notice failed:', sendError.message));
    } finally {
      if (!this.store.enabled && record?.session) {
        try { await provider.releaseSession?.(record.session); }
        catch (error) { console.error(`[${providerName}] session cleanup failed:`, error.message); }
      }
    }
  }
}
