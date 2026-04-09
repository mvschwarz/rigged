import { describe, it, expect } from "vitest";
import { fetchWithTimeout, FetchTimeoutError } from "../src/fetch-with-timeout.js";

describe("fetchWithTimeout", () => {
  it("rejects with FetchTimeoutError when fetch blackholes", async () => {
    const fetchImpl: typeof fetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason ?? new Error("aborted"));
      }, { once: true });
    })) as typeof fetch;

    await expect(
      fetchWithTimeout(fetchImpl, "http://localhost:7433/healthz", {}, {
        timeoutMs: 20,
        timeoutMessage: "probe timed out",
      }),
    ).rejects.toThrow(FetchTimeoutError);
  });
});
