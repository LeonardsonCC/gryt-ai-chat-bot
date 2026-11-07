import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';

/** Versioned records preserve provider/model affinity and adapter-owned session data. */
export class ConversationStore {
  #records = new Map();
  #write = Promise.resolve();
  constructor(path, backupPath) { this.path = path; this.backupPath = backupPath; }
  async load() {
    let raw;
    try { raw = await readFile(this.path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const data = JSON.parse(raw);
    if (data.version === 1 && Array.isArray(data.conversations)) {
      for (const record of data.conversations) this.#records.set(record.gryThreadId, record);
      return;
    }
    // Legacy map was Gryt thread -> Codex thread id. Preserve it before conversion.
    await copyFile(this.path, this.backupPath);
    for (const [gryThreadId, sessionId] of Object.entries(data)) {
      this.#records.set(gryThreadId, { id: gryThreadId, gryThreadId, provider: 'codex', model: 'gpt-6-luna', session: { threadId: sessionId }, history: [] });
    }
    await this.#save();
  }
  get(gryThreadId) { return this.#records.get(gryThreadId); }
  set(record) { this.#records.set(record.gryThreadId, record); return this.#save(); }
  async #save() {
    const run = async () => {
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: 1, conversations: [...this.#records.values()] }, null, 2), { mode: 0o600 });
      await rename(temporary, this.path);
    };
    this.#write = this.#write.catch(() => {}).then(run);
    return this.#write;
  }
}
