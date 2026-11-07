export class ThreadQueue {
  #queues = new Map();
  enqueue(key, work) {
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work).finally(() => {
      if (this.#queues.get(key) === next) this.#queues.delete(key);
    });
    this.#queues.set(key, next);
    return next;
  }
  async drain() { await Promise.allSettled(this.#queues.values()); }
}
