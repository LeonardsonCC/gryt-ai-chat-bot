import { CodexAppServer } from './app-server-client.js';
export class CodexProvider {
  constructor(config) { this.client = new CodexAppServer(config); }
  start() { return this.client.start(); }
  createSession() { return this.client.createSession(); }
  reply(args) { return this.client.reply(args); }
  stop() { return this.client.stop(); }
  on(...args) { this.client.on(...args); return this; }
}
