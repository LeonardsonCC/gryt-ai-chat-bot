import { CodexAppServer } from './app-server-client.js';
export class CodexProvider {
  constructor(config) { this.client = new CodexAppServer(config); }
  start() { return this.client.start(); }
  createSession(args) { return this.client.createSession(args); }
  pruneHistory(cutoff) { return this.client.pruneHistory(cutoff); }
  releaseSession(session) { return this.client.releaseSession(session); }
  reply(args) { return this.client.reply(args); }
  stop() { return this.client.stop(); }
  on(...args) { this.client.on(...args); return this; }
}
