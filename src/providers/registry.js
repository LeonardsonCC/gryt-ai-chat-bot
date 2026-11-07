export class ProviderRegistry {
  #providers;
  #started = new Map();
  constructor(providers) { this.#providers = new Map(Object.entries(providers)); }
  get(name) { const provider = this.#providers.get(name); if (!provider) throw new Error(`Provider not registered: ${name}`); return provider; }
  async start(name) {
    if (!this.#started.has(name)) {
      const starting = Promise.resolve().then(() => this.get(name).start());
      this.#started.set(name, starting);
      starting.catch(() => this.#started.delete(name));
    }
    await this.#started.get(name);
  }
  async stop() { await Promise.allSettled([...this.#started.keys()].map(name => this.get(name).stop())); }
}
