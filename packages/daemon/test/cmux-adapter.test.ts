import { describe, it, expect, vi } from "vitest";
import { CmuxAdapter } from "../src/adapters/cmux.js";
import type {
  CmuxTransport,
  CmuxTransportFactory,
  CmuxStatus,
} from "../src/adapters/cmux.js";

function workingFactory(capabilities: string[] = ["workspace.list", "surface.list", "surface.focus"]): CmuxTransportFactory {
  return async () => ({
    request: async (method: string) => {
      if (method === "capabilities") {
        return { capabilities };
      }
      return {};
    },
    close: () => {},
  });
}

function failingFactory(code: string): CmuxTransportFactory {
  return async () => {
    const err = new Error(`connect failed`) as Error & { code?: string };
    err.code = code;
    throw err;
  };
}

function hangingFactory(): CmuxTransportFactory {
  return () => new Promise(() => {
    // Never resolves — simulates timeout
  });
}

describe("CmuxAdapter", () => {
  it("connect with working factory: available=true, capabilities populated", async () => {
    const adapter = new CmuxAdapter(workingFactory(), { timeoutMs: 1000 });
    await adapter.connect();

    const status = adapter.getStatus();
    expect(status.available).toBe(true);
    expect(status.capabilities["workspace.list"]).toBe(true);
    expect(status.capabilities["surface.list"]).toBe(true);
    expect(status.capabilities["surface.focus"]).toBe(true);
  });

  it("connect with factory throwing ENOENT: available=false, capabilities={}", async () => {
    const adapter = new CmuxAdapter(failingFactory("ENOENT"), { timeoutMs: 1000 });
    await adapter.connect();

    const status = adapter.getStatus();
    expect(status.available).toBe(false);
    expect(status.capabilities).toEqual({});
  });

  it("connect with factory throwing ECONNREFUSED: available=false, capabilities={}", async () => {
    const adapter = new CmuxAdapter(failingFactory("ECONNREFUSED"), { timeoutMs: 1000 });
    await adapter.connect();

    const status = adapter.getStatus();
    expect(status.available).toBe(false);
    expect(status.capabilities).toEqual({});
  });

  it("connect with factory that times out: available=false, capabilities={}", async () => {
    const adapter = new CmuxAdapter(hangingFactory(), { timeoutMs: 50 });
    await adapter.connect();

    const status = adapter.getStatus();
    expect(status.available).toBe(false);
    expect(status.capabilities).toEqual({});
  });

  it("connect where factory succeeds but capabilities hang: available=false", async () => {
    // Factory connects fine, but request("capabilities") never resolves
    const closeSpy = vi.fn();
    const factory: CmuxTransportFactory = async () => ({
      request: () => new Promise(() => {
        // Never resolves
      }),
      close: closeSpy,
    });

    const adapter = new CmuxAdapter(factory, { timeoutMs: 50 });
    await adapter.connect();

    const status = adapter.getStatus();
    expect(status.available).toBe(false);
    expect(status.capabilities).toEqual({});
  });

  it("transport is closed when factory succeeds but capabilities hang", async () => {
    const closeSpy = vi.fn();
    const factory: CmuxTransportFactory = async () => ({
      request: () => new Promise(() => {
        // Never resolves — capabilities hang
      }),
      close: closeSpy,
    });

    const adapter = new CmuxAdapter(factory, { timeoutMs: 50 });
    await adapter.connect();

    // Transport was opened by factory, but capabilities timed out.
    // The adapter must close the transient transport to avoid leak.
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("transport is closed when factory succeeds but capabilities throw", async () => {
    const closeSpy = vi.fn();
    const factory: CmuxTransportFactory = async () => ({
      request: async () => {
        throw new Error("capabilities request failed");
      },
      close: closeSpy,
    });

    const adapter = new CmuxAdapter(factory, { timeoutMs: 1000 });
    await adapter.connect();

    expect(adapter.isAvailable()).toBe(false);
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("getStatus returns typed CmuxStatus", async () => {
    const adapter = new CmuxAdapter(workingFactory(["workspace.list"]), { timeoutMs: 1000 });
    await adapter.connect();

    const status: CmuxStatus = adapter.getStatus();
    expect(status).toHaveProperty("available");
    expect(status).toHaveProperty("capabilities");
    expect(typeof status.available).toBe("boolean");
    expect(typeof status.capabilities).toBe("object");
  });

  it("isAvailable returns false when not connected", () => {
    const adapter = new CmuxAdapter(workingFactory(), { timeoutMs: 1000 });
    // No connect() called
    expect(adapter.isAvailable()).toBe(false);
  });

  it("capability detection: transport returns feature list, maps to capability record", async () => {
    const features = ["workspace.list", "workspace.create", "surface.focus", "sidebar.metadata"];
    const adapter = new CmuxAdapter(workingFactory(features), { timeoutMs: 1000 });
    await adapter.connect();

    const status = adapter.getStatus();
    expect(status.available).toBe(true);
    for (const f of features) {
      expect(status.capabilities[f]).toBe(true);
    }
    // A capability not in the list should be undefined/falsy
    expect(status.capabilities["nonexistent.capability"]).toBeFalsy();
  });

  it("reconnect after failure: second connect() with working factory succeeds", async () => {
    let callCount = 0;
    const factory: CmuxTransportFactory = async () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error("connect failed") as Error & { code?: string };
        err.code = "ECONNREFUSED";
        throw err;
      }
      return {
        request: async (method: string) => {
          if (method === "capabilities") {
            return { capabilities: ["workspace.list"] };
          }
          return {};
        },
        close: () => {},
      };
    };

    const adapter = new CmuxAdapter(factory, { timeoutMs: 1000 });

    // First connect fails
    await adapter.connect();
    expect(adapter.isAvailable()).toBe(false);

    // Second connect succeeds (factory called again — real reconnect)
    await adapter.connect();
    expect(adapter.isAvailable()).toBe(true);
    expect(adapter.getStatus().capabilities["workspace.list"]).toBe(true);
    expect(callCount).toBe(2);
  });
});
