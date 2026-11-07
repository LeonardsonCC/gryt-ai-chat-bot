import { userMessage } from '../application/prompt-policy.js';

/** Fetch pages backwards, then return a chronological transcript before the triggering message. */
export async function readThreadHistory(bot, mention, message, threadId) {
  const collected = new Map();
  let root, before;
  do {
    const page = await bot.thread(message.conversationId, threadId, { limit: 100, ...(before ? { before } : {}) });
    if (!page.thread) throw new Error('Gryt thread is unavailable');
    root ??= page.root;
    for (const item of page.replies) collected.set(item.messageId, item);
    if (!page.hasMore) break;
    const next = page.replies[0]?.createdAt?.toISOString();
    if (!next || (before && next >= before)) throw new Error('Gryt thread pagination did not advance');
    before = next;
  } while (true);
  if (root) collected.set(root.messageId, root);
  let rows = [...collected.values()].sort((a, b) => a.createdAt - b.createdAt);
  const current = rows.findIndex(item => item.messageId === message.messageId);
  rows = current >= 0 ? rows.slice(0, current) : rows.filter(item => !message.createdAt || item.createdAt <= message.createdAt);
  const addressed = rows.some(item => item.isOwn || mention.test(item.text ?? ''));
  const history = rows.filter(item => !item.isSystem && item.text?.trim()).map(item => item.isOwn
    ? { role: 'assistant', content: item.text }
    : userMessage(item, item.text.replace(mention, '').trim()));
  return { addressed, history };
}
