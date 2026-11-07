import { readFile, rename, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

/** A bounded disk cache. Gryt remains the source of conversation history. */
export class ConversationStore {
  #records = new Map();
  #write = Promise.resolve();
  constructor(path, backupPath, { enabled = false, ttlMs = 7 * 86400000, now = Date.now, onExpire = async () => {} } = {}) {
    Object.assign(this, { path, backupPath, enabled, ttlMs, now, onExpire });
  }
  async load() {
    if (!this.enabled) { await this.prune(); return; }
    let raw;
    try { raw = await readFile(this.path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') { await this.prune(); return; } throw error; }
    const data = JSON.parse(raw);
    if (data.version != null && ![1, 2, 3].includes(data.version)) throw new Error('Unsupported conversation cache version');
    // Undated legacy records are discarded; the next message reloads the Gryt thread.
    for (const record of data.conversations ?? []) {
      if (Number.isFinite(record.cachedAt)) record.expiresAt = Math.min(record.expiresAt, record.cachedAt + this.ttlMs);
      if (Number.isFinite(record.expiresAt) && record.expiresAt > this.now()) this.#records.set(record.gryThreadId, record);
    }
    await this.prune();
  }
  get(gryThreadId) {
    if (!this.enabled) return undefined;
    const record = this.#records.get(gryThreadId);
    return record?.expiresAt > this.now() ? structuredClone(record) : undefined;
  }
  async set(record) {
    if (!this.enabled) return structuredClone(record);
    const previous = this.#records.get(record.gryThreadId);
    if (previous && previous.expiresAt <= this.now()) await this.onExpire(previous);
    const cached = structuredClone(record);
    cached.cachedAt ??= this.now();
    cached.expiresAt = Math.min(cached.expiresAt ?? cached.cachedAt + this.ttlMs, cached.cachedAt + this.ttlMs);
    this.#records.set(cached.gryThreadId, cached);
    await this.#save();
    return structuredClone(cached);
  }
  async prune() {
    for (const [id, record] of this.#records) {
      if (!this.enabled || record.expiresAt <= this.now()) {
        await this.onExpire(record);
        if (this.#records.get(id) === record) this.#records.delete(id);
      }
    }
    if (this.enabled) await this.#save();
    else await this.flush();
    // Old migration backups/temp files must not retain transcripts indefinitely either.
    const paths = new Set([this.backupPath, ...(!this.enabled ? [this.path] : [])]);
    const names = await readdir(dirname(this.path)).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const name of names) {
      if (name.startsWith(`${basename(this.path)}.`) && /\.(bak|tmp)$/.test(name)) paths.add(join(dirname(this.path), name));
    }
    for (const path of paths) {
      if (!path || (this.enabled && path === this.path)) continue;
      try { if (!this.enabled || (await stat(path)).mtimeMs + this.ttlMs <= this.now()) await unlink(path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  async flush() { await this.#write; }
  async #save() {
    const run = async () => {
      const temporary = `${this.path}.${process.pid}.tmp`;
      const conversations = [...this.#records.values()].filter(record => record.expiresAt > this.now());
      await writeFile(temporary, JSON.stringify({ version: 3, conversations }, null, 2), { mode: 0o600 });
      await rename(temporary, this.path);
    };
    this.#write = this.#write.catch(() => {}).then(run);
    return this.#write;
  }
}
