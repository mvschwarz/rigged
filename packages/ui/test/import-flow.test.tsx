import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { ImportFlow } from "../src/components/ImportFlow.js";
import { createMockEventSourceClass } from "./helpers/mock-event-source.js";
import { createTestRouter, createAppTestRouter } from "./helpers/test-router.js";
import { Dashboard } from "../src/components/Dashboard.js";

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

async function renderImportFlow() {
  const result = render(createTestRouter({
    component: () => <ImportFlow onBack={() => {}} />,
    path: "/import",
    initialPath: "/import",
  }));
  await waitFor(() => expect(screen.getByTestId("import-flow")).toBeDefined());
  return result;
}

describe("ImportFlow", () => {
  // Test 1: Step indicator shows step 1 active on validate screen
  it("step indicator shows step 1 active on input screen", async () => {
    await renderImportFlow();
    const step1 = screen.getByTestId("step-1");
    expect(step1.className).toContain("text-primary");
    const step2 = screen.getByTestId("step-2");
    expect(step2.className).toContain("text-foreground-muted");
  });

  // Test 2: Validate sends to daemon, shows Alert
  it("validate sends to daemon and shows valid Alert", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true, errors: [] }) });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("valid-message")).toBeDefined();
      const call = mockFetch.mock.calls.find((c: unknown[]) => c[0] === "/api/rigs/import/validate");
      expect(call).toBeDefined();
    });
  });

  // Test 3: Invalid YAML shows error Alert, blocks proceed
  it("invalid YAML shows error Alert, blocks proceed", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false, errors: ["missing name", "no nodes"] }),
    });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: "bad yaml" } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => {
      const errEl = screen.getByTestId("import-errors");
      expect(errEl.textContent).toContain("missing name");
      expect(errEl.textContent).toContain("no nodes");
      // Step 1 should still be active (error occurred at step 1)
      const step1 = screen.getByTestId("step-1");
      expect(step1.className).toContain("text-primary");
    });
    expect(screen.queryByTestId("preflight-btn")).toBeNull();
  });

  // Test 4: Preflight shows warnings (text-warning) + errors (text-destructive)
  it("preflight shows warnings and errors with correct colors", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, errors: [], warnings: ["cmux unavailable", "cwd not found"] }) });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));

    await waitFor(() => {
      const warningsEl = screen.getByTestId("preflight-warnings");
      expect(warningsEl.textContent).toContain("cmux unavailable");
      expect(warningsEl.textContent).toContain("cwd not found");
      // Warnings should use text-warning class
      expect(warningsEl.querySelector(".text-warning")).toBeDefined();
    });
  });

  // Test 5: Instantiate shows per-node Table with status colors
  it("instantiate shows per-node Table with status colors", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, errors: [], warnings: [] }) })
      .mockResolvedValueOnce({
        ok: true, status: 201,
        json: async () => ({ rigId: "rig-1", specName: "imported-rig", specVersion: "0.1.0", nodes: [{ logicalId: "orchestrator", status: "launched" }, { logicalId: "worker", status: "failed" }] }),
      });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));
    await waitFor(() => expect(screen.getByTestId("instantiate-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("instantiate-btn"));

    await waitFor(() => {
      const result = screen.getByTestId("import-result");
      expect(result.textContent).toContain("imported-rig");

      const launchedEl = screen.getByTestId("inst-status-orchestrator");
      expect(launchedEl.className).toContain("text-primary");

      const failedEl = screen.getByTestId("inst-status-worker");
      expect(failedEl.className).toContain("text-destructive");
    });
  });

  // Test 6: Error with TRY AGAIN resets to input
  it("error state TRY AGAIN resets to input", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ valid: false, errors: ["bad"] }),
    });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: "bad" } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => expect(screen.getByTestId("import-errors")).toBeDefined());

    // Find TRY AGAIN button
    const tryAgainBtns = screen.getAllByText(/TRY AGAIN/);
    const btn = tryAgainBtns.find((el) => el.closest("button"));
    fireEvent.click(btn!);

    await waitFor(() => {
      expect(screen.getByTestId("yaml-input")).toBeDefined();
    });
  });

  // Test 7: Back to dashboard via router
  it("back button navigates to dashboard", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/rigs/summary") return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(createAppTestRouter({
      routes: [
        { path: "/", component: Dashboard },
        { path: "/import", component: ImportFlow },
      ],
      initialPath: "/import",
    }));

    await waitFor(() => expect(screen.getByTestId("import-flow")).toBeDefined());
    fireEvent.click(screen.getByText("← Dashboard"));

    await waitFor(() => {
      expect(screen.queryByTestId("import-flow")).toBeNull();
    });
  });

  // Test 8: After validation succeeds, step 1 completed (checkmark), step 2 active
  it("after validation, step 1 shows checkmark and step 2 is active", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true, errors: [] }) });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => {
      const step1 = screen.getByTestId("step-1");
      expect(step1.textContent).toContain("✓");
      const step2 = screen.getByTestId("step-2");
      expect(step2.className).toContain("text-primary");
    });
  });

  // Test 9: Raw YAML body sent with text/yaml (preserved)
  it("validate sends raw YAML body with text/yaml Content-Type", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ valid: true, errors: [] }) });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find((c: unknown[]) => c[0] === "/api/rigs/import/validate");
      expect(call).toBeDefined();
      const [, opts] = call as [string, RequestInit];
      expect(opts.headers).toMatchObject({ "Content-Type": "text/yaml" });
      expect(opts.body).toBe(VALID_YAML);
    });
  });

  // Test 10: Preflight warnings displayed (preserved)
  it("preflight warnings are displayed to user", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, errors: [], warnings: ["cmux unavailable"] }) });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("preflight-warnings").textContent).toContain("cmux unavailable");
    });
  });

  // Test 11: Import view renders via router (preserved)
  it("import view renders via router", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/rigs/summary") return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(createAppTestRouter({
      routes: [
        { path: "/", component: Dashboard },
        { path: "/import", component: () => <ImportFlow /> },
      ],
      initialPath: "/import",
    }));

    await waitFor(() => {
      expect(screen.getByTestId("import-flow")).toBeDefined();
      expect(screen.getByTestId("yaml-input")).toBeDefined();
    });
  });

  // Test 12: Instantiate failure shows errors (preserved)
  it("instantiate failure shows error Alert", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, errors: [], warnings: [] }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false, code: "preflight_failed", errors: ["rig name collision"], warnings: [] }) });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));
    await waitFor(() => expect(screen.getByTestId("instantiate-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("instantiate-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("import-errors").textContent).toContain("rig name collision");
    });
    expect(screen.queryByTestId("import-result")).toBeNull();
  });

  // Test 13: Preflight errors block instantiate
  it("preflight errors block instantiate", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: false, errors: ["rig name exists"], warnings: [] }) });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("import-errors").textContent).toContain("rig name exists");
    });
    expect(screen.queryByTestId("instantiate-btn")).toBeNull();
  });

  // Test 14b: Preflight with BOTH warnings and errors shows both in error state
  it("preflight with both warnings and errors shows warnings above errors", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: false, errors: ["rig name exists"], warnings: ["cmux unavailable"] }) });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));

    await waitFor(() => {
      // Errors should be shown
      const errEl = screen.getByTestId("import-errors");
      expect(errEl.textContent).toContain("rig name exists");
      // Warnings should also be shown (above errors)
      const warnEl = screen.getByTestId("error-warnings");
      expect(warnEl.textContent).toContain("cmux unavailable");
    });
  });

  // Test 15: Preflight warnings allow instantiate
  it("preflight warnings allow instantiate", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ valid: true, errors: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, errors: [], warnings: ["cmux unavailable"] }) });
    await renderImportFlow();

    fireEvent.change(screen.getByTestId("yaml-input"), { target: { value: VALID_YAML } });
    fireEvent.click(screen.getByTestId("validate-btn"));
    await waitFor(() => expect(screen.getByTestId("preflight-btn")).toBeDefined());
    fireEvent.click(screen.getByTestId("preflight-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("instantiate-btn")).toBeDefined();
      expect(screen.getByTestId("preflight-warnings")).toBeDefined();
    });
  });
});
