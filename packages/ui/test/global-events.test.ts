import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { useGlobalEvents } from "../src/hooks/useGlobalEvents.js";

// Mock EventSource
let mockEventSource: { addEventListener: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
let messageHandlers: Array<(event: { data: string }) => void> = [];

vi.stubGlobal("EventSource", class MockEventSource {
  constructor() {
    mockEventSource = {
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === "message") messageHandlers.push(handler);
      }),
      close: vi.fn(),
    };
    Object.assign(this, mockEventSource);
  }
  addEventListener = vi.fn();
  close = vi.fn();
});

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useGlobalEvents", () => {
  afterEach(() => {
    messageHandlers = [];
    cleanup();
  });

  it("subscribes to /api/events on mount", () => {
    renderHook(() => useGlobalEvents(), { wrapper: createWrapper() });
    // EventSource constructor was called
    expect(mockEventSource.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
  });

  it("invalidates rig node inventory on startup events", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(() => useGlobalEvents(), { wrapper });

    // Simulate a startup event
    act(() => {
      for (const handler of messageHandlers) {
        handler({ data: JSON.stringify({ type: "node.startup_ready", rigId: "rig-1", nodeId: "n1" }) });
      }
    });

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 200));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["rig", "rig-1", "nodes"] });
  });

  it("invalidates rigs summary and ps on rig lifecycle events", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(() => useGlobalEvents(), { wrapper });

    act(() => {
      for (const handler of messageHandlers) {
        handler({ data: JSON.stringify({ type: "rig.stopped", rigId: "rig-1" }) });
      }
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["rigs", "summary"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["ps"] });
  });

  it("invalidates rigs summary, ps, AND rig node inventory on restore.completed", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);

    renderHook(() => useGlobalEvents(), { wrapper });

    act(() => {
      for (const handler of messageHandlers) {
        handler({ data: JSON.stringify({ type: "restore.completed", rigId: "rig-2" }) });
      }
    });

    await new Promise((r) => setTimeout(r, 200));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["rigs", "summary"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["ps"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["rig", "rig-2", "nodes"] });
  });
});
