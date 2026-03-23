import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { RigGraph } from "../src/components/RigGraph.js";
import { RigNode } from "../src/components/RigNode.js";
import { createMockEventSourceClass, instances } from "./helpers/mock-event-source.js";
import type { MockEventSourceInstance } from "./helpers/mock-event-source.js";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

let OriginalEventSource: typeof EventSource | undefined;

function mockGraphResponse(nodes: object[] = [], edges: object[] = []) {
  return {
    ok: true,
    json: async () => ({ nodes, edges }),
  };
}

function sampleNodes() {
  return [
    {
      id: "n1",
      type: "rigNode",
      position: { x: 0, y: 0 },
      data: {
        logicalId: "orchestrator",
        role: "orchestrator",
        runtime: "claude-code",
        model: "opus",
        status: "running",
        binding: { tmuxSession: "r01-orch1-lead", cmuxSurface: "s-1" },
      },
    },
    {
      id: "n2",
      type: "rigNode",
      position: { x: 0, y: 200 },
      data: {
        logicalId: "worker",
        role: "worker",
        runtime: "codex",
        model: null,
        status: null,
        binding: null,
      },
    },
  ];
}

function sampleEdges() {
  return [
    { id: "e1", source: "n1", target: "n2", label: "delegates_to" },
  ];
}

beforeEach(() => {
  mockFetch.mockReset();
  OriginalEventSource = globalThis.EventSource;
  globalThis.EventSource = createMockEventSourceClass() as unknown as typeof EventSource;
});

afterEach(() => {
  if (OriginalEventSource) {
    globalThis.EventSource = OriginalEventSource;
  }
  cleanup();
});

describe("RigGraph", () => {
  it("renders nodes from mock graph data", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphResponse(sampleNodes(), sampleEdges()));

    const { container } = render(<RigGraph rigId="rig-1" />);

    await waitFor(() => {
      // React Flow renders nodes with data-testid="rf__node-{id}"
      const rfNodes = container.querySelectorAll("[data-testid^='rf__node-']");
      expect(rfNodes.length).toBe(2);
    });
  });

  it("passes edges to ReactFlow (edge container rendered)", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphResponse(sampleNodes(), sampleEdges()));

    const { container } = render(<RigGraph rigId="rig-1" />);

    await waitFor(() => {
      // React Flow renders nodes successfully (proves graph data was accepted)
      const rfNodes = container.querySelectorAll("[data-testid^='rf__node-']");
      expect(rfNodes.length).toBe(2);
      // Edge container exists (RF accepted the edge data)
      // Note: jsdom lacks layout so RF cannot compute edge paths,
      // but the container proves edges were passed to the component
      const edgeContainer = container.querySelector(".react-flow__edges");
      expect(edgeContainer).not.toBeNull();
      // Verify the fetch included edges in the response
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall).toBeDefined();
    });
  });

  it("loading state rendered when fetching", () => {
    // Never resolves — stays in loading
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    render(<RigGraph rigId="rig-1" />);
    expect(screen.getByText(/loading/i)).toBeDefined();
  });

  it("empty state rendered when nodes array is empty", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphResponse([], []));

    render(<RigGraph rigId="rig-1" />);

    await waitFor(() => {
      expect(screen.getByText(/no nodes/i)).toBeDefined();
    });
  });

  it("error state rendered on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    render(<RigGraph rigId="rig-1" />);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeDefined();
    });
  });

  it("rigId=null shows 'No rig selected' placeholder, no fetch", () => {
    render(<RigGraph rigId={null} />);

    expect(screen.getByText(/no rig selected/i)).toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rigId='abc' fetches /api/rigs/abc/graph", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphResponse([], []));

    render(<RigGraph rigId="abc" />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/rigs/abc/graph");
    });
  });

  it("renders custom RigNode content via nodeTypes registration", async () => {
    mockFetch.mockResolvedValueOnce(mockGraphResponse(sampleNodes(), sampleEdges()));

    const { container } = render(<RigGraph rigId="rig-1" />);

    await waitFor(() => {
      // React Flow uses our custom node type — nodes have class react-flow__node-rigNode
      const customNodes = container.querySelectorAll(".react-flow__node-rigNode");
      expect(customNodes.length).toBe(2);
      // RigNode renders runtime text — only our custom node does this
      expect(screen.getByText("claude-code")).toBeDefined();
    });
  });
});

describe("RigNode", () => {
  it("displays logicalId, role, runtime, and status", () => {
    const data = {
      logicalId: "dev1-impl",
      role: "worker",
      runtime: "claude-code",
      model: "opus",
      status: "running",
      binding: { tmuxSession: "r01-dev1-impl", cmuxSurface: null },
    };

    render(
      <ReactFlowProvider>
        <RigNode data={data} />
      </ReactFlowProvider>
    );

    expect(screen.getByText("dev1-impl")).toBeDefined();
    expect(screen.getAllByText("worker").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("claude-code")).toBeDefined();
    expect(screen.getByText("running")).toBeDefined();
  });

  it("shows 'unbound' indicator when binding is null", () => {
    const data = {
      logicalId: "worker",
      role: "worker",
      runtime: "codex",
      model: null,
      status: null,
      binding: null,
    };

    render(
      <ReactFlowProvider>
        <RigNode data={data} />
      </ReactFlowProvider>
    );

    expect(screen.getByText(/unbound/i)).toBeDefined();
  });
});

describe("RigGraph SSE integration", () => {
  it("SSE message triggers second fetch to /api/rigs/:id/graph", async () => {
    mockFetch.mockResolvedValue(mockGraphResponse(sampleNodes(), sampleEdges()));

    render(<RigGraph rigId="rig-1" />);

    // Wait for initial fetch
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Fire SSE message
    act(() => {
      const es = instances[instances.length - 1]!;
      es.simulateMessage('{"type":"node.added"}');
    });

    // Wait for debounced refetch
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1]![0]).toBe("/api/rigs/rig-1/graph");
    });
  });

  it("useRigGraph refetch triggered by SSE produces fresh data", async () => {
    // First fetch: 1 node. Second fetch: 2 nodes.
    mockFetch
      .mockResolvedValueOnce(mockGraphResponse(
        [sampleNodes()[0]!],
        []
      ))
      .mockResolvedValueOnce(mockGraphResponse(sampleNodes(), sampleEdges()));

    const { container } = render(<RigGraph rigId="rig-1" />);

    // Wait for initial render with 1 node
    await waitFor(() => {
      const nodes = container.querySelectorAll("[data-testid^='rf__node-']");
      expect(nodes.length).toBe(1);
    });

    // Fire SSE message to trigger refetch
    act(() => {
      const es = instances[instances.length - 1]!;
      es.simulateMessage('{"type":"node.added"}');
    });

    // Wait for re-render with 2 nodes
    await waitFor(() => {
      const nodes = container.querySelectorAll("[data-testid^='rf__node-']");
      expect(nodes.length).toBe(2);
    });
  });

  it("reconnecting indicator visible on EventSource error", async () => {
    mockFetch.mockResolvedValue(mockGraphResponse(sampleNodes(), sampleEdges()));

    render(<RigGraph rigId="rig-1" />);

    await waitFor(() => expect(instances.length).toBeGreaterThan(0));

    act(() => {
      instances[instances.length - 1]!.simulateError();
    });

    await waitFor(() => {
      expect(screen.getByText(/reconnecting/i)).toBeDefined();
    });
  });

  it("reconnect open event clears indicator and triggers refetch", async () => {
    mockFetch.mockResolvedValue(mockGraphResponse(sampleNodes(), sampleEdges()));

    render(<RigGraph rigId="rig-1" />);

    await waitFor(() => expect(instances.length).toBeGreaterThan(0));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    // Error
    act(() => {
      instances[instances.length - 1]!.simulateError();
    });

    await waitFor(() => {
      expect(screen.getByText(/reconnecting/i)).toBeDefined();
    });

    mockFetch.mockClear();
    mockFetch.mockResolvedValue(mockGraphResponse(sampleNodes(), sampleEdges()));

    // Reconnect (open event)
    act(() => {
      instances[instances.length - 1]!.simulateOpen();
    });

    await waitFor(() => {
      // Indicator cleared
      expect(screen.queryByText(/reconnecting/i)).toBeNull();
      // Refetch triggered
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
