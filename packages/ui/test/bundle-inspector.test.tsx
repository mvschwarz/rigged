import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BundleInspector } from "../src/components/BundleInspector.js";
import { eventColor, eventSummary, type ActivityEvent } from "../src/hooks/useActivityFeed.js";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => { fetchMock = vi.fn(); globalThis.fetch = fetchMock; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const INSPECT_RESPONSE = {
  manifest: {
    name: "test-bundle", version: "0.1.0", rigSpec: "rig.yaml",
    packages: [{ name: "review-kit", version: "1.0.0", path: "packages/review-kit" }],
    integrity: { algorithm: "sha256", files: { "rig.yaml": "abc", "packages/review-kit/SKILL.md": "def" } },
  },
  digestValid: true,
  integrityResult: { passed: true, mismatches: [], missing: [], extra: [], errors: [] },
};

describe("BundleInspector", () => {
  // T1: Shows manifest details
  it("shows manifest name, version, and rig_spec", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => INSPECT_RESPONSE });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><BundleInspector /></QueryClientProvider>);

    act(() => { fireEvent.change(screen.getByTestId("bundle-path-input"), { target: { value: "/tmp/test.rigbundle" } }); });
    act(() => { fireEvent.click(screen.getByTestId("inspect-btn")); });

    await waitFor(() => {
      expect(screen.getByTestId("manifest-summary")).toBeTruthy();
      expect(screen.getByTestId("manifest-summary").textContent).toContain("test-bundle");
      expect(screen.getByTestId("manifest-summary").textContent).toContain("v0.1.0");
    });
  });

  // T2: Integrity status (green/red)
  it("shows integrity status as PASS or FAIL", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => INSPECT_RESPONSE });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><BundleInspector /></QueryClientProvider>);

    act(() => { fireEvent.change(screen.getByTestId("bundle-path-input"), { target: { value: "/tmp/test.rigbundle" } }); });
    act(() => { fireEvent.click(screen.getByTestId("inspect-btn")); });

    await waitFor(() => {
      expect(screen.getByTestId("integrity-status").textContent).toContain("PASS");
    });
  });

  // T3: Package list renders
  it("renders package list", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => INSPECT_RESPONSE });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><BundleInspector /></QueryClientProvider>);

    act(() => { fireEvent.change(screen.getByTestId("bundle-path-input"), { target: { value: "/tmp/x.rigbundle" } }); });
    act(() => { fireEvent.click(screen.getByTestId("inspect-btn")); });

    await waitFor(() => {
      const entries = screen.getAllByTestId("package-entry");
      expect(entries).toHaveLength(1);
      expect(entries[0]!.textContent).toContain("review-kit");
    });
  });

  // T4: Install button present
  it("shows install button after inspection", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => INSPECT_RESPONSE });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><BundleInspector /></QueryClientProvider>);

    act(() => { fireEvent.change(screen.getByTestId("bundle-path-input"), { target: { value: "/tmp/x.rigbundle" } }); });
    act(() => { fireEvent.click(screen.getByTestId("inspect-btn")); });

    await waitFor(() => {
      expect(screen.getByTestId("install-btn")).toBeTruthy();
    });
  });

  // T6-AS-T14: v2 manifest renders agents list instead of packages
  it("v2 manifest renders agents list instead of packages", async () => {
    const v2Response = {
      manifest: {
        schemaVersion: 2,
        name: "pod-bundle",
        version: "0.2.0",
        rigSpec: "rig.yaml",
        agents: [
          { name: "impl-agent", version: "1.0.0", path: "agents/impl" },
          { name: "review-agent", version: "1.1.0", path: "agents/review" },
        ],
      },
      digestValid: true,
      integrityResult: { passed: true, mismatches: [], missing: [], extra: [], errors: [] },
    };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => v2Response });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><BundleInspector /></QueryClientProvider>);

    act(() => { fireEvent.change(screen.getByTestId("bundle-path-input"), { target: { value: "/tmp/v2.rigbundle" } }); });
    act(() => { fireEvent.click(screen.getByTestId("inspect-btn")); });

    await waitFor(() => {
      // Should show agents, not packages
      expect(screen.getByTestId("agent-list")).toBeTruthy();
      const entries = screen.getAllByTestId("agent-entry");
      expect(entries).toHaveLength(2);
      expect(entries[0]!.textContent).toContain("impl-agent");
      expect(entries[1]!.textContent).toContain("review-agent");
      // Should NOT show package-list
      expect(screen.queryByTestId("package-list")).toBeNull();
      // Schema badge should show v2
      expect(screen.getByTestId("schema-badge").textContent).toContain("v2");
    });
  });

  // T6: Error state
  it("shows error on inspect failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><BundleInspector /></QueryClientProvider>);

    act(() => { fireEvent.change(screen.getByTestId("bundle-path-input"), { target: { value: "/tmp/bad.rigbundle" } }); });
    act(() => { fireEvent.click(screen.getByTestId("inspect-btn")); });

    await waitFor(() => {
      expect(screen.getByTestId("inspect-error")).toBeTruthy();
    });
  });
});

// T5: Activity feed bundle.created event
describe("Bundle activity feed events", () => {
  function makeEvent(overrides: { type: string; payload?: Record<string, unknown> }): ActivityEvent {
    return { seq: 1, type: overrides.type, payload: { type: overrides.type, ...overrides.payload }, createdAt: new Date().toISOString(), receivedAt: Date.now() };
  }

  it("bundle.created uses bg-accent color and correct summary", () => {
    expect(eventColor("bundle.created")).toBe("bg-accent");
    const event = makeEvent({ type: "bundle.created", payload: { bundleName: "my-bundle", bundleVersion: "1.0.0" } });
    expect(eventSummary(event)).toContain("my-bundle");
    expect(eventSummary(event)).toContain("v1.0.0");
    expect(eventSummary(event)).toContain("bundled");
  });
});
