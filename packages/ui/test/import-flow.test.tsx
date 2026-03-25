import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { ImportFlow } from "../src/components/ImportFlow.js";
import { App } from "../src/App.js";
import { createMockEventSourceClass } from "./helpers/mock-event-source.js";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

let OriginalEventSource: typeof EventSource | undefined;

beforeEach(() => {
  mockFetch.mockReset();
  OriginalEventSource = globalThis.EventSource;
  globalThis.EventSource = createMockEventSourceClass() as unknown as typeof EventSource;
});

afterEach(() => {
  if (OriginalEventSource) globalThis.EventSource = OriginalEventSource;
  cleanup();
});

const VALID_YAML = "schema_version: 1\nname: test-rig\nnodes: []\n";

describe("ImportFlow", () => {
  // Test 1: Upload -> validate endpoint called
  it("validate button calls POST /api/rigs/import/validate", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true, errors: [] }) });

    render(<ImportFlow onBack={() => {}} />);
    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: unknown[]) => c[0] === "/api/rigs/import/validate"
      );
      expect(call).toBeDefined();
    });
  });

  // Test 2: Invalid -> errors shown, blocks proceed
  it("invalid spec shows errors and blocks proceed", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false, errors: ["missing name", "no nodes"] }),
    });

    render(<ImportFlow onBack={() => {}} />);
    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: "bad yaml" } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => {
      const errEl = screen.getByTestId("import-errors");
      expect(errEl.textContent).toContain("missing name");
      expect(errEl.textContent).toContain("no nodes");
    });

    // Should not show preflight button
    expect(screen.queryByTestId("preflight-btn")).toBeNull();
  });

  // Test 3: Valid -> preflight step
  it("valid spec advances to preflight step", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true, errors: [] }) });

    render(<ImportFlow onBack={() => {}} />);
    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("valid-message")).toBeDefined();
      expect(screen.getByTestId("preflight-btn")).toBeDefined();
    });
  });

  // Test 4: Preflight errors -> blocks proceed
  it("preflight errors block instantiate", async () => {
    // First call: validate passes
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      // Second call: preflight errors
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: false, errors: ["rig name exists"], warnings: [] }) });

    render(<ImportFlow onBack={() => {}} />);
    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));

    await waitFor(() => {
      const errEl = screen.getByTestId("import-errors");
      expect(errEl.textContent).toContain("rig name exists");
    });

    // No instantiate button
    expect(screen.queryByTestId("instantiate-btn")).toBeNull();
  });

  // Test 5: Preflight warnings -> allows proceed
  it("preflight warnings allow instantiate", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, errors: [], warnings: ["cmux unavailable"] }) });

    render(<ImportFlow onBack={() => {}} />);
    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("instantiate-btn")).toBeDefined();
    });
  });

  // Test 6: Instantiate -> per-node status
  it("successful instantiate shows per-node status", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, errors: [], warnings: [] }) })
      .mockResolvedValueOnce({
        ok: true, status: 201,
        json: async () => ({ rigId: "rig-1", specName: "imported-rig", specVersion: "0.1.0", nodes: [{ logicalId: "orchestrator", status: "launched" }, { logicalId: "worker", status: "launched" }] }),
      });

    render(<ImportFlow onBack={() => {}} />);
    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));
    await waitFor(() => expect(screen.getByTestId("instantiate-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("instantiate-btn"));

    await waitFor(() => {
      const result = screen.getByTestId("import-result");
      expect(result.textContent).toContain("imported-rig");
      expect(result.textContent).toContain("orchestrator");
      expect(result.textContent).toContain("worker");
    });
  });

  // Test 7: Instantiate failure -> error
  it("instantiate failure shows error", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, errors: [], warnings: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false, code: "preflight_failed", errors: ["rig name collision"], warnings: [] }) });

    render(<ImportFlow onBack={() => {}} />);
    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));
    await waitFor(() => expect(screen.getByTestId("instantiate-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("instantiate-btn"));

    await waitFor(() => {
      const errEl = screen.getByTestId("import-errors");
      expect(errEl.textContent).toContain("rig name collision");
    });

    // No result
    expect(screen.queryByTestId("import-result")).toBeNull();
  });

  // Test 8: App integration: import view renders ImportFlow
  it("App: import view renders ImportFlow component", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/rigs/summary") {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: "r1", name: "alpha", nodeCount: 1, latestSnapshotAt: null, latestSnapshotId: null }],
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());

    fireEvent.click(screen.getByText("Import Rig"));

    await waitFor(() => {
      expect(screen.getByTestId("import-flow")).toBeDefined();
      expect(screen.getByTestId("yaml-input")).toBeDefined();
    });
  });

  // Test 9: Back to dashboard from import flow
  it("back button returns to dashboard from import", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/rigs/summary") {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: "r1", name: "alpha", nodeCount: 1, latestSnapshotAt: null, latestSnapshotId: null }],
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<App />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeDefined());

    fireEvent.click(screen.getByText("Import Rig"));
    await waitFor(() => expect(screen.getByTestId("import-flow")).toBeDefined());

    fireEvent.click(screen.getByText("Back to Dashboard"));
    await waitFor(() => {
      expect(screen.queryByTestId("import-flow")).toBeNull();
      expect(screen.getByText(/loading dashboard|alpha|no rigs/i)).toBeDefined();
    });
  });

  // Test 10: validate sends raw YAML text body with text/yaml
  it("validate sends raw YAML body with text/yaml Content-Type", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true, errors: [] }) });

    render(<ImportFlow onBack={() => {}} />);
    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find(
        (c: unknown[]) => c[0] === "/api/rigs/import/validate"
      );
      expect(call).toBeDefined();
      const [, opts] = call as [string, RequestInit];
      expect(opts.headers).toMatchObject({ "Content-Type": "text/yaml" });
      // Body is raw YAML string, not JSON-stringified
      expect(opts.body).toBe(VALID_YAML);
    });
  });

  // Test 11: Preflight warnings are displayed
  it("preflight warnings are displayed to user", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, errors: [], warnings: ["cmux unavailable", "cwd not found"] }) });

    render(<ImportFlow onBack={() => {}} />);
    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));

    await waitFor(() => {
      const warningsEl = screen.getByTestId("preflight-warnings");
      expect(warningsEl.textContent).toContain("cmux unavailable");
      expect(warningsEl.textContent).toContain("cwd not found");
    });
  });
});
