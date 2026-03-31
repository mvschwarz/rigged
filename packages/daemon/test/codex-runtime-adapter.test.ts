import { describe, it, expect, vi } from "vitest";
import { CodexRuntimeAdapter, type CodexAdapterFsOps } from "../src/adapters/codex-runtime-adapter.js";
import type { NodeBinding, ResolvedStartupFile } from "../src/domain/runtime-adapter.js";
import type { ProjectionPlan, ProjectionEntry } from "../src/domain/projection-planner.js";
import type { TmuxAdapter } from "../src/adapters/tmux.js";

function mockTmux(overrides?: Partial<TmuxAdapter>): TmuxAdapter {
  return {
    sendText: vi.fn(async () => ({ ok: true as const })),
    hasSession: vi.fn(async () => true),
    createSession: vi.fn(async () => ({ ok: true as const })),
    killSession: vi.fn(async () => ({ ok: true as const })),
    listSessions: vi.fn(async () => []),
    listWindows: vi.fn(async () => []),
    listPanes: vi.fn(async () => []),
    sendKeys: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  } as unknown as TmuxAdapter;
}

function mockFs(files?: Record<string, string>): CodexAdapterFsOps {
  const store: Record<string, string> = { ...files };
  return {
    readFile: (p: string) => { if (p in store) return store[p]!; throw new Error(`Not found: ${p}`); },
    writeFile: (p: string, c: string) => { store[p] = c; },
    exists: (p: string) => p in store,
    mkdirp: () => {},
    listFiles: (dir: string) => Object.keys(store).filter((k) => k.startsWith(dir + "/")).map((k) => k.slice(dir.length + 1)),
    _store: store,
  } as CodexAdapterFsOps & { _store: Record<string, string> };
}

function makeBinding(cwd = "/project"): NodeBinding {
  return {
    id: "b1", nodeId: "n1", tmuxSession: "r01-qa", tmuxWindow: null, tmuxPane: null,
    cmuxWorkspace: null, cmuxSurface: null, updatedAt: "", cwd,
  };
}

describe("Codex runtime adapter", () => {
  // T2: implements all four methods
  it("implements all four methods", () => {
    const adapter = new CodexRuntimeAdapter({ tmux: mockTmux(), fsOps: mockFs() });
    expect(typeof adapter.listInstalled).toBe("function");
    expect(typeof adapter.project).toBe("function");
    expect(typeof adapter.deliverStartup).toBe("function");
    expect(typeof adapter.checkReady).toBe("function");
    expect(adapter.runtime).toBe("codex");
  });

  // T7: checkReady returns true for responsive session
  it("checkReady returns true for responsive session", async () => {
    const tmux = mockTmux({ hasSession: vi.fn(async () => true) });
    const adapter = new CodexRuntimeAdapter({ tmux, fsOps: mockFs() });
    const result = await adapter.checkReady(makeBinding());
    expect(result.ready).toBe(true);
  });

  // T8: listInstalled reports projected resources
  it("listInstalled reports projected resources in .agents/", async () => {
    const fs = mockFs({
      "/project/.agents/skills": "", // directory marker
      "/project/.agents/skills/deep-review/SKILL.md": "content",
    });
    const adapter = new CodexRuntimeAdapter({ tmux: mockTmux(), fsOps: fs });
    const result = await adapter.listInstalled(makeBinding());
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.category).toBe("skill");
  });

  // T10: deliverStartup does NOT execute startup actions
  it("deliverStartup only handles files, no action execution", async () => {
    // Verify that the interface only accepts ResolvedStartupFile[], not StartupAction[]
    const adapter = new CodexRuntimeAdapter({ tmux: mockTmux(), fsOps: mockFs({ "/rig/file.md": "content" }) });
    const file: ResolvedStartupFile = {
      path: "file.md", absolutePath: "/rig/file.md", ownerRoot: "/rig",
      deliveryHint: "guidance_merge", required: true, appliesOn: ["fresh_start"],
    };
    const result = await adapter.deliverStartup([file], makeBinding());
    expect(result.delivered).toBe(1);
    // No action-related methods called — only file delivery
  });

  // T11: structured failure on delivery error
  it("returns structured failure when delivery fails", async () => {
    const fs = mockFs({}); // empty — file not found
    const adapter = new CodexRuntimeAdapter({ tmux: mockTmux(), fsOps: fs });
    const file: ResolvedStartupFile = {
      path: "missing.md", absolutePath: "/rig/missing.md", ownerRoot: "/rig",
      deliveryHint: "guidance_merge", required: true, appliesOn: ["fresh_start"],
    };
    const result = await adapter.deliverStartup([file], makeBinding());
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.path).toBe("missing.md");
    expect(result.failed[0]!.error).toContain("Not found");
  });

  // T12: replay on restore is safe for already-projected content
  it("replay on restore is safe for already-projected content", async () => {
    const fs = mockFs({
      "/rig/guide.md": "# Guidance",
      "/project/AGENTS.md": "<!-- BEGIN RIGGED MANAGED BLOCK: guide.md -->\n# Guidance\n<!-- END RIGGED MANAGED BLOCK: guide.md -->",
    });
    const adapter = new CodexRuntimeAdapter({ tmux: mockTmux(), fsOps: fs });
    const file: ResolvedStartupFile = {
      path: "guide.md", absolutePath: "/rig/guide.md", ownerRoot: "/rig",
      deliveryHint: "guidance_merge", required: true, appliesOn: ["fresh_start", "restore"],
    };

    // Deliver twice — should replace managed block, not duplicate
    await adapter.deliverStartup([file], makeBinding());
    await adapter.deliverStartup([file], makeBinding());

    const store = (fs as unknown as { _store: Record<string, string> })._store;
    const content = store["/project/AGENTS.md"]!;
    const blockCount = (content.match(/BEGIN RIGGED MANAGED BLOCK/g) ?? []).length;
    expect(blockCount).toBe(1); // exactly one block, not two
  });

  // NS-T04: launchHarness tests
  it("launchHarness sends correct fresh launch command", async () => {
    const tmux = mockTmux();
    const adapter = new CodexRuntimeAdapter({ tmux, fsOps: mockFs() });

    const result = await adapter.launchHarness(makeBinding(), { name: "dev-qa@test-rig" });

    expect(result.ok).toBe(true);
    const sendText = tmux.sendText as ReturnType<typeof vi.fn>;
    expect(sendText).toHaveBeenCalledWith("r01-qa", "codex");
  });

  it("launchHarness sends correct resume command", async () => {
    const tmux = mockTmux();
    const adapter = new CodexRuntimeAdapter({ tmux, fsOps: mockFs() });

    const result = await adapter.launchHarness(makeBinding(), { name: "dev-qa@test-rig", resumeToken: "sess-456" });

    expect(result.ok).toBe(true);
    const sendText = tmux.sendText as ReturnType<typeof vi.fn>;
    expect(sendText).toHaveBeenCalledWith("r01-qa", "codex resume sess-456");
  });
});
