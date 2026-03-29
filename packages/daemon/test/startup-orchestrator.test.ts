import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createFullTestDb } from "./helpers/test-app.js";
import { SessionRegistry } from "../src/domain/session-registry.js";
import { EventBus } from "../src/domain/event-bus.js";
import { RigRepository } from "../src/domain/rig-repository.js";
import { StartupOrchestrator, type StartupInput } from "../src/domain/startup-orchestrator.js";
import type { RuntimeAdapter, NodeBinding, ResolvedStartupFile, ProjectionResult, StartupDeliveryResult, ReadinessResult } from "../src/domain/runtime-adapter.js";
import type { ProjectionPlan } from "../src/domain/projection-planner.js";
import type { TmuxAdapter } from "../src/adapters/tmux.js";
import type { StartupAction } from "../src/domain/types.js";

// -- Mocks --

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

function mockAdapter(overrides?: Partial<RuntimeAdapter>): RuntimeAdapter {
  return {
    runtime: "claude-code",
    listInstalled: vi.fn(async () => []),
    project: vi.fn(async () => ({ projected: [], skipped: [], failed: [] })),
    deliverStartup: vi.fn(async () => ({ delivered: 0, failed: [] })),
    checkReady: vi.fn(async () => ({ ready: true })),
    ...overrides,
  };
}

function emptyPlan(): ProjectionPlan {
  return { runtime: "claude-code", cwd: ".", entries: [], startup: { files: [], actions: [] }, conflicts: [], noOps: [], diagnostics: [] };
}

function makeBinding(): NodeBinding {
  return { id: "b1", nodeId: "n1", tmuxSession: "r01-impl", tmuxWindow: null, tmuxPane: null, cmuxWorkspace: null, cmuxSurface: null, updatedAt: "", cwd: "." };
}

function makeAction(overrides?: Partial<StartupAction>): StartupAction {
  return { type: "slash_command", value: "/test", phase: "after_ready", appliesOn: ["fresh_start", "restore"], idempotent: true, ...overrides };
}

describe("StartupOrchestrator", () => {
  let db: Database.Database;
  let sessionRegistry: SessionRegistry;
  let eventBus: EventBus;
  let rigRepo: RigRepository;
  let tmux: TmuxAdapter;

  beforeEach(() => {
    db = createFullTestDb();
    sessionRegistry = new SessionRegistry(db);
    eventBus = new EventBus(db);
    rigRepo = new RigRepository(db);
    tmux = mockTmux();
  });

  afterEach(() => { db.close(); });

  function createOrchestrator(tmuxOverride?: TmuxAdapter): StartupOrchestrator {
    return new StartupOrchestrator({ db, sessionRegistry, eventBus, tmuxAdapter: tmuxOverride ?? tmux });
  }

  function seedSession(): { rigId: string; nodeId: string; sessionId: string } {
    const rig = rigRepo.createRig("test-rig");
    const node = rigRepo.addNode(rig.id, "impl", { runtime: "claude-code" });
    const session = sessionRegistry.registerSession(node.id, "r01-impl");
    sessionRegistry.updateStatus(session.id, "running");
    return { rigId: rig.id, nodeId: node.id, sessionId: session.id };
  }

  function makeInput(seed: { rigId: string; nodeId: string; sessionId: string }, overrides?: Partial<StartupInput>): StartupInput {
    return {
      rigId: seed.rigId,
      nodeId: seed.nodeId,
      sessionId: seed.sessionId,
      binding: makeBinding(),
      adapter: mockAdapter(),
      plan: emptyPlan(),
      resolvedStartupFiles: [],
      startupActions: [],
      isRestore: false,
      ...overrides,
    };
  }

  // T1: fresh launch enters pending before startup delivery
  it("marks pending before delivery", async () => {
    const seed = seedSession();
    const adapter = mockAdapter();
    let statusDuringProject = "";
    (adapter.project as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const row = db.prepare("SELECT startup_status FROM sessions WHERE id = ?").get(seed.sessionId) as { startup_status: string };
      statusDuringProject = row.startup_status;
      return { projected: [], skipped: [], failed: [] };
    });

    const orch = createOrchestrator();
    await orch.startNode(makeInput(seed, { adapter }));
    expect(statusDuringProject).toBe("pending");
  });

  // T2: successful startup transitions to ready
  it("successful startup transitions to ready", async () => {
    const seed = seedSession();
    const orch = createOrchestrator();
    const result = await orch.startNode(makeInput(seed));
    expect(result.ok).toBe(true);
    expect(result.startupStatus).toBe("ready");

    const row = db.prepare("SELECT startup_status, startup_completed_at FROM sessions WHERE id = ?").get(seed.sessionId) as { startup_status: string; startup_completed_at: string | null };
    expect(row.startup_status).toBe("ready");
    expect(row.startup_completed_at).not.toBeNull();
  });

  // T3: delivery failure transitions to failed
  it("delivery failure transitions to failed", async () => {
    const seed = seedSession();
    const adapter = mockAdapter({
      deliverStartup: vi.fn(async () => ({ delivered: 0, failed: [{ path: "startup.md", error: "disk full" }] })),
    });
    const orch = createOrchestrator();
    const result = await orch.startNode(makeInput(seed, { adapter }));
    expect(result.ok).toBe(false);
    expect(result.startupStatus).toBe("failed");

    const row = db.prepare("SELECT startup_status FROM sessions WHERE id = ?").get(seed.sessionId) as { startup_status: string };
    expect(row.startup_status).toBe("failed");
  });

  // T4: action failure transitions to failed
  it("action failure transitions to failed", async () => {
    const seed = seedSession();
    const failTmux = mockTmux({ sendText: vi.fn(async () => ({ ok: false as const, message: "session gone" })) });
    const orch = createOrchestrator(failTmux);
    const actions: StartupAction[] = [makeAction({ phase: "after_ready" })];
    const result = await orch.startNode(makeInput(seed, { startupActions: actions }));
    expect(result.ok).toBe(false);
    expect(result.startupStatus).toBe("failed");
  });

  // T5: after_files runs before checkReady, after_ready runs only after
  it("after_files actions run before checkReady; after_ready after", async () => {
    const seed = seedSession();
    const callOrder: string[] = [];

    const adapter = mockAdapter({
      project: vi.fn(async () => { callOrder.push("project"); return { projected: [], skipped: [], failed: [] }; }),
      deliverStartup: vi.fn(async () => { callOrder.push("deliver"); return { delivered: 1, failed: [] }; }),
      checkReady: vi.fn(async () => { callOrder.push("checkReady"); return { ready: true }; }),
    });

    const t = mockTmux({
      sendText: vi.fn(async (target: string, text: string) => {
        callOrder.push(`action:${text}`);
        return { ok: true as const };
      }),
    });

    const orch = createOrchestrator(t);
    const actions: StartupAction[] = [
      makeAction({ phase: "after_files", value: "/after-files-cmd" }),
      makeAction({ phase: "after_ready", value: "/after-ready-cmd" }),
    ];
    await orch.startNode(makeInput(seed, { adapter, startupActions: actions }));

    const deliverIdx = callOrder.indexOf("deliver");
    const afterFilesIdx = callOrder.indexOf("action:/after-files-cmd");
    const checkReadyIdx = callOrder.indexOf("checkReady");
    const afterReadyIdx = callOrder.indexOf("action:/after-ready-cmd");

    expect(afterFilesIdx).toBeGreaterThan(deliverIdx);
    expect(checkReadyIdx).toBeGreaterThan(afterFilesIdx);
    expect(afterReadyIdx).toBeGreaterThan(checkReadyIdx);
  });

  // T6: non-idempotent restore action is skipped
  it("non-idempotent action skipped on restore", async () => {
    const seed = seedSession();
    const orch = createOrchestrator();
    const actions: StartupAction[] = [
      makeAction({ value: "/setup-once", idempotent: false, appliesOn: ["fresh_start"] }),
    ];
    const result = await orch.startNode(makeInput(seed, { startupActions: actions, isRestore: true }));
    expect(result.ok).toBe(true);
    expect(tmux.sendText).not.toHaveBeenCalled();
  });

  // T7: idempotent restore action replays safely
  it("idempotent action replays on restore", async () => {
    const seed = seedSession();
    const orch = createOrchestrator();
    const actions: StartupAction[] = [
      makeAction({ value: "/rename impl", idempotent: true, appliesOn: ["fresh_start", "restore"] }),
    ];
    const result = await orch.startNode(makeInput(seed, { startupActions: actions, isRestore: true }));
    expect(result.ok).toBe(true);
    expect(tmux.sendText).toHaveBeenCalledWith("r01-impl", "/rename impl");
  });

  // T8: operator debug append executes after resolved startup
  it("operator debug actions execute in startup sequence", async () => {
    const seed = seedSession();
    const orch = createOrchestrator();
    // Operator debug actions are just regular actions added last by the startup resolver
    const actions: StartupAction[] = [
      makeAction({ value: "/debug-overlay", phase: "after_ready" }),
    ];
    const result = await orch.startNode(makeInput(seed, { startupActions: actions }));
    expect(result.ok).toBe(true);
    expect(tmux.sendText).toHaveBeenCalledWith("r01-impl", "/debug-overlay");
  });

  // T9: reconciler reports failed startup state
  it("failed startup visible in session query", async () => {
    const seed = seedSession();
    const adapter = mockAdapter({
      checkReady: vi.fn(async () => ({ ready: false, reason: "not responding" })),
    });
    const orch = createOrchestrator();
    await orch.startNode(makeInput(seed, { adapter }));

    // Session should show failed startup
    const sessions = sessionRegistry.getSessionsForRig(seed.rigId);
    const session = sessions.find((s) => s.id === seed.sessionId);
    expect(session).toBeDefined();
    expect(session!.startupStatus).toBe("failed");
  });

  // T10: launcher does not mark ready before actions complete
  it("startup_status stays pending until orchestrator completes", async () => {
    const seed = seedSession();
    // After NodeLauncher creates session, startupStatus is pending (default from AS-T00)
    const row = db.prepare("SELECT startup_status FROM sessions WHERE id = ?").get(seed.sessionId) as { startup_status: string };
    expect(row.startup_status).toBe("pending"); // launcher left it as default

    // Only after orchestrator.startNode completes does it become ready
    const orch = createOrchestrator();
    await orch.startNode(makeInput(seed));
    const afterRow = db.prepare("SELECT startup_status FROM sessions WHERE id = ?").get(seed.sessionId) as { startup_status: string };
    expect(afterRow.startup_status).toBe("ready");
  });

  // T11: retrying failed startup does not duplicate irreversible work
  it("retry-as-restore skips non-idempotent fresh_start actions", async () => {
    const seed = seedSession();

    // First attempt: fails during action (non-idempotent action executes then something else fails)
    const failAdapter = mockAdapter({
      checkReady: vi.fn()
        .mockResolvedValueOnce({ ready: true }) // first attempt: ready
        .mockResolvedValueOnce({ ready: true }), // retry: ready
    });
    const failTmux = mockTmux({
      sendText: vi.fn()
        .mockResolvedValueOnce({ ok: true }) // first attempt: action succeeds
        .mockResolvedValueOnce({ ok: false, message: "second action fails" }) // first attempt: second action fails
        .mockResolvedValueOnce({ ok: true }), // retry: idempotent action succeeds
    });

    const orch = createOrchestrator(failTmux);
    const actions: StartupAction[] = [
      makeAction({ value: "/setup-once", idempotent: false, phase: "after_ready", appliesOn: ["fresh_start"] }),
      makeAction({ value: "/configure", idempotent: true, phase: "after_ready", appliesOn: ["fresh_start", "restore"] }),
    ];

    // First attempt fails on second action
    const r1 = await orch.startNode(makeInput(seed, { adapter: failAdapter, startupActions: actions, isRestore: false }));
    expect(r1.ok).toBe(false);

    // Retry as restore — non-idempotent /setup-once should be skipped
    const r2 = await orch.startNode(makeInput(seed, { adapter: failAdapter, startupActions: actions, isRestore: true }));
    expect(r2.ok).toBe(true);

    // /setup-once was called once (first attempt only), /configure called in retry
    const calls = (failTmux.sendText as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(calls.filter((c: string) => c === "/setup-once")).toHaveLength(1);
  });

  // T12a: fresh-start-only startup files skipped on restore
  it("fresh-start-only startup files skipped on restore", async () => {
    const seed = seedSession();
    const adapter = mockAdapter();
    const files: ResolvedStartupFile[] = [
      { path: "fresh.md", absolutePath: "/rig/fresh.md", ownerRoot: "/rig", deliveryHint: "auto", required: true, appliesOn: ["fresh_start"] },
      { path: "always.md", absolutePath: "/rig/always.md", ownerRoot: "/rig", deliveryHint: "auto", required: true, appliesOn: ["fresh_start", "restore"] },
    ];
    const orch = createOrchestrator();
    await orch.startNode(makeInput(seed, { adapter, resolvedStartupFiles: files, isRestore: true }));

    // Only "always.md" should be delivered, not "fresh.md"
    const deliverCalls = (adapter.deliverStartup as ReturnType<typeof vi.fn>).mock.calls;
    expect(deliverCalls).toHaveLength(1);
    const deliveredFiles = deliverCalls[0][0] as ResolvedStartupFile[];
    expect(deliveredFiles).toHaveLength(1);
    expect(deliveredFiles[0]!.path).toBe("always.md");
  });

  // T12b: emits correct lifecycle events
  it("emits startup_pending and startup_ready events", async () => {
    const seed = seedSession();
    const events: string[] = [];
    eventBus.subscribe((e) => events.push(e.type));

    const orch = createOrchestrator();
    await orch.startNode(makeInput(seed));

    expect(events).toContain("node.startup_pending");
    expect(events).toContain("node.startup_ready");
    expect(events.indexOf("node.startup_pending")).toBeLessThan(events.indexOf("node.startup_ready"));
  });
});
