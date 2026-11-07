import { EventEmitter } from 'node:events';
import { GrytBot } from '@gryt/bot';

export class GrytTransport extends EventEmitter {
  constructor(config) {
    super(); this.mention = config.mention;
    this.bot = new GrytBot({ host: config.grytHost, nickname: config.nickname, description: 'Assistente de conversa; cada conversa segue em uma thread.', wants: ['read_messages', 'send_messages', 'upload_avatar_image'], identityPath: config.identityPath, prefix: '', helpCommand: false });
    this.bot.on('message', message => this.emit('message', message));
    this.bot.on('error', error => this.emit('error', error));
    this.bot.on('waiting', message => this.emit('waiting', message));
    this.bot.on('ready', info => this.emit('ready', info));
  }
  start() { return this.bot.start(); }
  startThread(message, title) { return this.bot.startThread(message.conversationId, message.messageId, title); }
  send(message, threadId, text) { return this.bot.send(message.conversationId, text, { threadId }); }
  typing(message, threadId) { return this.bot.typing(message.conversationId, threadId); }
  stopTyping(message, threadId) { return this.bot.stopTyping(message.conversationId, threadId); }
  async stop() { await this.bot.stop(); }
}
