import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";

export class CodexAppServer extends EventEmitter {
  #proc;
  #nextId = 1;
  #pending = new Map();
  #turns = new Map();
  #loadedThreads = new Set();
  #ready;

  async start() {
    this.#proc = spawn("codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env,
    });
    const lines = createInterface({ input: this.#proc.stdout });
    lines.on("line", (line) => this.#onLine(line));
    this.#proc.on("exit", (code) => {
      const error = new Error(`codex app-server exited (${code ?? "signal"})`);
      for (const pending of this.#pending.values()) pending.reject(error);
      for (const turn of this.#turns.values()) turn.reject(error);
      this.#pending.clear();
      this.#turns.clear();
      this.emit("exit", code);
    });
    this.#ready = this.request("initialize", {
      clientInfo: { name: "gryt_codex_bot", title: "Gryt Codex Bot", version: "0.1.0" },
      capabilities: { experimentalApi: true },
    });
    await this.#ready;
    this.#write({ method: "initialized", params: {} });
  }

  #write(value) {
    if (!this.#proc?.stdin.writable) throw new Error("codex app-server stdin is closed");
    this.#proc.stdin.write(`${JSON.stringify(value)}\n`);
  }

  request(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#write({ method, id, params });
    });
  }

  #onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && this.#pending.has(message.id)) {
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "Codex request failed"));
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "item/agentMessage/delta") {
      const threadId = message.params?.threadId;
      const turn = this.#turns.get(threadId);
      if (turn) turn.text += message.params?.delta ?? "";
    } else if (message.method === "turn/completed") {
      const { threadId, turn } = message.params ?? {};
      const pending = this.#turns.get(threadId);
      if (!pending) return;
      this.#turns.delete(threadId);
      if (turn?.status === "completed") pending.resolve(pending.text.trim());
      else pending.reject(new Error(turn?.error?.message ?? `Codex turn ${turn?.status ?? "failed"}`));
    } else if (message.method === "error") {
      this.emit("error", new Error(message.params?.message ?? "Codex app-server error"));
    }
  }

  async newThread() {
    await this.#ready;
    const result = await this.request("thread/start", {
      model: process.env.CODEX_MODEL ?? "gpt-6-luna",
      cwd: "/tmp/gryt-codex",
      approvalPolicy: "never",
      permissions: "gryt_chat",
      serviceName: "gryt_codex_bot",
    });
    this.#loadedThreads.add(result.thread.id);
    return result.thread.id;
  }

  async resume(threadId) {
    await this.#ready;
    if (this.#loadedThreads.has(threadId)) return;
    await this.request("thread/resume", { threadId, excludeTurns: true });
    this.#loadedThreads.add(threadId);
  }

  async stop() {
    if (!this.#proc) return;
    this.#proc.stdin.end();
    this.#proc.kill("SIGTERM");
  }

  async turn(threadId, text) {
    await this.#ready;
    await this.resume(threadId);
    if (this.#turns.has(threadId)) throw new Error("A reply is already being generated for this thread");
    const pending = { text: "", resolve: null, reject: null };
    const completed = new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    this.#turns.set(threadId, pending);
    try {
      await this.request("turn/start", {
        threadId,
        input: [{ type: "text", text }],
        cwd: "/tmp/gryt-codex",
        approvalPolicy: "never",
        permissions: "gryt_chat",
        model: process.env.CODEX_MODEL ?? "gpt-6-luna",
        effort: "medium",
      });
    } catch (error) {
      this.#turns.delete(threadId);
      throw error;
    }
    return completed;
  }
}
