export class ProviderRegistry {
  #providers;
  constructor(providers) { this.#providers = new Map(Object.entries(providers)); }
  get(name) { const provider = this.#providers.get(name); if (!provider) throw new Error(`Provider not registered: ${name}`); return provider; }
}
