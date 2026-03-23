import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import { useState } from "react";
import { useRigEvents } from "../src/hooks/useRigEvents.js";
import { createMockEventSourceClass, instances } from "./helpers/mock-event-source.js";
import type { MockEventSourceInstance } from "./helpers/mock-event-source.js";

let OriginalEventSource: typeof EventSource | undefined;

beforeEach(() => {
  OriginalEventSource = globalThis.EventSource;
  globalThis.EventSource = createMockEventSourceClass() as unknown as typeof EventSource;
});

afterEach(() => {
  if (OriginalEventSource) {
    globalThis.EventSource = OriginalEventSource;
  }
  cleanup();
});

// Test harness component that exposes hook state
function HookHarness({ rigId, onEvent }: { rigId: string | null; onEvent: () => void }) {
  const { connected, reconnecting } = useRigEvents(rigId, onEvent);
  return (
    <div>
      <span data-testid="connected">{String(connected)}</span>
      <span data-testid="reconnecting">{String(reconnecting)}</span>
    </div>
  );
}

// Harness that allows rigId change
function ChangingRigHarness({ onEvent }: { onEvent: () => void }) {
  const [rigId, setRigId] = useState<string | null>("rig-1");
  return (
    <div>
      <HookHarness rigId={rigId} onEvent={onEvent} />
      <button onClick={() => setRigId("rig-2")}>change</button>
      <button onClick={() => setRigId(null)}>clear</button>
    </div>
  );
}

function getLastInstance(): MockEventSourceInstance {
  return instances[instances.length - 1]!;
}

describe("useRigEvents hook", () => {
  it("opens EventSource to correct URL", async () => {
    const onEvent = vi.fn();
    render(<HookHarness rigId="rig-1" onEvent={onEvent} />);

    await waitFor(() => {
      expect(instances).toHaveLength(1);
      expect(instances[0]!.url).toBe("/api/events?rigId=rig-1");
    });
  });

  it("on SSE message -> onEvent callback invoked", async () => {
    const onEvent = vi.fn();
    render(<HookHarness rigId="rig-1" onEvent={onEvent} />);

    await waitFor(() => expect(instances).toHaveLength(1));

    act(() => {
      getLastInstance().simulateMessage('{"type":"rig.created"}');
    });

    await waitFor(() => {
      expect(onEvent).toHaveBeenCalled();
    });
  });

  it("debounce: rapid events -> onEvent called once per batch", async () => {
    const onEvent = vi.fn();
    render(<HookHarness rigId="rig-1" onEvent={onEvent} />);

    await waitFor(() => expect(instances).toHaveLength(1));

    // Fire 5 rapid messages
    act(() => {
      for (let i = 0; i < 5; i++) {
        getLastInstance().simulateMessage(`{"type":"event.${i}"}`);
      }
    });

    // Wait for debounce to settle
    await new Promise((r) => setTimeout(r, 200));

    // Should be called fewer times than 5 (debounced)
    expect(onEvent.mock.calls.length).toBeLessThan(5);
    expect(onEvent.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("rigId=null -> no EventSource opened", () => {
    const onEvent = vi.fn();
    render(<HookHarness rigId={null} onEvent={onEvent} />);

    expect(instances).toHaveLength(0);
  });

  it("EventSource error -> reconnecting=true", async () => {
    const onEvent = vi.fn();
    render(<HookHarness rigId="rig-1" onEvent={onEvent} />);

    await waitFor(() => expect(instances).toHaveLength(1));

    act(() => {
      getLastInstance().simulateError();
    });

    await waitFor(() => {
      expect(screen.getByTestId("reconnecting").textContent).toBe("true");
    });
  });

  it("unmount -> EventSource.close() called", async () => {
    const onEvent = vi.fn();
    const { unmount } = render(<HookHarness rigId="rig-1" onEvent={onEvent} />);

    await waitFor(() => expect(instances).toHaveLength(1));
    const instance = getLastInstance();

    unmount();

    expect(instance.close).toHaveBeenCalled();
  });

  it("rigId change -> old EventSource closed, new one opened", async () => {
    const onEvent = vi.fn();
    const { getByText } = render(<ChangingRigHarness onEvent={onEvent} />);

    await waitFor(() => {
      expect(instances).toHaveLength(1);
      expect(instances[0]!.url).toBe("/api/events?rigId=rig-1");
    });

    const firstInstance = instances[0]!;

    act(() => {
      getByText("change").click();
    });

    await waitFor(() => {
      expect(firstInstance.close).toHaveBeenCalled();
      expect(instances).toHaveLength(2);
      expect(instances[1]!.url).toBe("/api/events?rigId=rig-2");
    });
  });

  it("reconnect: open event after error -> reconnecting=false, onEvent called", async () => {
    const onEvent = vi.fn();
    render(<HookHarness rigId="rig-1" onEvent={onEvent} />);

    await waitFor(() => expect(instances).toHaveLength(1));

    // Error first
    act(() => {
      getLastInstance().simulateError();
    });

    await waitFor(() => {
      expect(screen.getByTestId("reconnecting").textContent).toBe("true");
    });

    onEvent.mockClear();

    // Reconnect (open event)
    act(() => {
      getLastInstance().simulateOpen();
    });

    await waitFor(() => {
      expect(screen.getByTestId("reconnecting").textContent).toBe("false");
      expect(onEvent).toHaveBeenCalled();
    });
  });

  it("initial open does NOT trigger onEvent (no extra refetch on first mount)", async () => {
    const onEvent = vi.fn();
    render(<HookHarness rigId="rig-1" onEvent={onEvent} />);

    // Wait for EventSource to open
    await waitFor(() => {
      expect(instances).toHaveLength(1);
    });

    // Wait past any debounce window
    await new Promise((r) => setTimeout(r, 200));

    // onEvent should NOT have been called from the initial open
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("error on rig-1 then change to rig-2 -> reconnecting clears on new open", async () => {
    const onEvent = vi.fn();
    const { getByText } = render(<ChangingRigHarness onEvent={onEvent} />);

    // Wait for rig-1 EventSource
    await waitFor(() => {
      expect(instances).toHaveLength(1);
      expect(instances[0]!.url).toBe("/api/events?rigId=rig-1");
    });

    // Error on rig-1 -> reconnecting=true
    act(() => {
      instances[0]!.simulateError();
    });

    await waitFor(() => {
      expect(screen.getByTestId("reconnecting").textContent).toBe("true");
    });

    // Change to rig-2
    act(() => {
      getByText("change").click();
    });

    // Old source closed, new one opened
    await waitFor(() => {
      expect(instances[0]!.close).toHaveBeenCalled();
      expect(instances.length).toBeGreaterThanOrEqual(2);
      expect(getLastInstance().url).toBe("/api/events?rigId=rig-2");
    });

    // reconnecting should be cleared by the rig change (not stuck from rig-1 error)
    await waitFor(() => {
      expect(screen.getByTestId("reconnecting").textContent).toBe("false");
    });
  });
});
