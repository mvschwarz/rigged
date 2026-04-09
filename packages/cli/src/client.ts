import { ConfigStore } from "./config-store.js";
import { readOpenRigEnv } from "./openrig-compat.js";
import { fetchWithTimeout } from "./fetch-with-timeout.js";

export class DaemonConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonConnectionError";
  }
}

export interface DaemonResponse<T = unknown> {
  status: number;
  data: T;
}

interface DaemonClientOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class DaemonClient {
  readonly baseUrl: string;
  private fetchImpl: typeof fetch = fetch;
  private timeoutMs = 5_000;

  constructor(baseUrl?: string, options?: DaemonClientOptions) {
    if (baseUrl) {
      this.baseUrl = baseUrl;
    } else {
      const envUrl = readOpenRigEnv("OPENRIG_URL", "RIGGED_URL");
      if (envUrl) {
        this.baseUrl = envUrl;
      } else {
        // Resolve from config (env > file > defaults)
        const config = new ConfigStore().resolve();
        this.baseUrl = `http://${config.daemon.host}:${config.daemon.port}`;
      }
    }

    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.timeoutMs = options?.timeoutMs ?? 5_000;
  }

  async get<T = unknown>(path: string): Promise<DaemonResponse<T>> {
    return this.requestJson<T>(path, { method: "GET" });
  }

  async getText(path: string): Promise<DaemonResponse<string>> {
    return this.requestText(path, { method: "GET" });
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<DaemonResponse<T>> {
    return this.requestJson<T>(path, {
      method: "POST",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async postText<T = unknown>(path: string, text: string, contentType = "text/yaml", extraHeaders?: Record<string, string>): Promise<DaemonResponse<T>> {
    return this.requestJson<T>(path, {
      method: "POST",
      headers: { "Content-Type": contentType, ...extraHeaders },
      body: text,
    });
  }

  async postExpectText(path: string, body?: unknown): Promise<DaemonResponse<string>> {
    return this.requestText(path, {
      method: "POST",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T = unknown>(path: string): Promise<DaemonResponse<T>> {
    return this.requestJson<T>(path, { method: "DELETE" });
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchWithTimeout(
        this.fetchImpl,
        `${this.baseUrl}${path}`,
        init,
        {
          timeoutMs: this.timeoutMs,
          timeoutMessage: `Request to ${this.baseUrl}${path} timed out after ${this.timeoutMs}ms`,
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new DaemonConnectionError(`Cannot connect to the OpenRig daemon at ${this.baseUrl}: ${msg}`);
    }
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<DaemonResponse<T>> {
    const res = await this.fetch(path, init);
    const data = (await res.json()) as T;
    return { status: res.status, data };
  }

  private async requestText(path: string, init: RequestInit): Promise<DaemonResponse<string>> {
    const res = await this.fetch(path, init);
    const data = await res.text();
    return { status: res.status, data };
  }
}
