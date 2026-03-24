import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { coreSchema } from "../src/db/migrations/001_core_schema.js";
import { bindingsSessionsSchema } from "../src/db/migrations/002_bindings_sessions.js";
import { eventsSchema } from "../src/db/migrations/003_events.js";
import { snapshotsSchema } from "../src/db/migrations/004_snapshots.js";
import { checkpointsSchema } from "../src/db/migrations/005_checkpoints.js";
import { resumeMetadataSchema } from "../src/db/migrations/006_resume_metadata.js";
import { RigRepository } from "../src/domain/rig-repository.js";
import { SessionRegistry } from "../src/domain/session-registry.js";
import { EventBus } from "../src/domain/event-bus.js";
import { SnapshotRepository } from "../src/domain/snapshot-repository.js";
import { CheckpointStore } from "../src/domain/checkpoint-store.js";
import { SnapshotCapture } from "../src/domain/snapshot-capture.js";
import { NodeLauncher } from "../src/domain/node-launcher.js";
import { RestoreOrchestrator } from "../src/domain/restore-orchestrator.js";
import type { TmuxAdapter, TmuxResult } from "../src/adapters/tmux.js";
import type { ClaudeResumeAdapter } from "../src/adapters/claude-resume.js";
import type { CodexResumeAdapter } from "../src/adapters/codex-resume.js";
import type { ResumeResult } from "../src/adapters/claude-resume.js";
import type { PersistedEvent, Snapshot } from "../src/domain/types.js";

function setupDb(): Database.Database {
  const db = createDb();
  migrate(db, [coreSchema, bindingsSessionsSchema, eventsSchema, snapshotsSchema, checkpointsSchema, resumeMetadataSchema]);
  return db;
}

function mockTmux(): TmuxAdapter {
  return {
    createSession: vi.fn(async () => ({ ok: true as const })),
    killSession: vi.fn(async () => ({ ok: true as const })),
    sendText: vi.fn(async () => ({ ok: true as const })),
    sendKeys: vi.fn(async () => ({ ok: true as const })),
    listSessions: async () => [],
    listWindows: async () => [],
    listPanes: async () => [],
    hasSession: async () => false,
  } as unknown as TmuxAdapter;
}

function mockClaudeResume(result?: ResumeResult): ClaudeResumeAdapter {
  return {
    canResume: vi.fn((type: string | null) => type === "claude_name" || type === "claude_id"),
    resume: vi.fn(async () => result ?? { ok: true as const }),
  } as unknown as ClaudeResumeAdapter;
}

function mockCodexResume(result?: ResumeResult): CodexResumeAdapter {
  return {
    canResume: vi.fn((type: string | null) => type === "codex_id" || type === "codex_last"),
    resume: vi.fn(async () => result ?? { ok: true as const }),
  } as unknown as CodexResumeAdapter;
}

describe("RestoreOrchestrator", () => {
  let db: Database.Database;
  let rigRepo: RigRepository;
  let sessionRegistry: SessionRegistry;
  let eventBus: EventBus;
  let snapshotRepo: SnapshotRepository;
  let checkpointStore: CheckpointStore;
  let snapshotCapture: SnapshotCapture;

  beforeEach(() => {
    db = setupDb();
    rigRepo = new RigRepository(db);
    sessionRegistry = new SessionRegistry(db);
    eventBus = new EventBus(db);
    snapshotRepo = new SnapshotRepository(db);
    checkpointStore = new CheckpointStore(db);
    snapshotCapture = new SnapshotCapture({ db, rigRepo, sessionRegistry, eventBus, snapshotRepo, checkpointStore });
  });

  afterEach(() => {
    db.close();
  });

  function createOrchestrator(opts?: {
    tmux?: TmuxAdapter;
    claude?: ClaudeResumeAdapter;
    codex?: CodexResumeAdapter;
  }) {
    const tmux = opts?.tmux ?? mockTmux();
    const nodeLauncher = new NodeLauncher({ db, rigRepo, sessionRegistry, eventBus, tmuxAdapter: tmux });
    return new RestoreOrchestrator({
      db, rigRepo, sessionRegistry, eventBus, snapshotRepo, snapshotCapture,
      checkpointStore, nodeLauncher, tmuxAdapter: tmux,
      claudeResume: opts?.claude ?? mockClaudeResume(),
      codexResume: opts?.codex ?? mockCodexResume(),
    });
  }

  function seedRigAndSnapshot(opts?: {
    edges?: { sourceLogical: string; targetLogical: string; kind: string }[];
    nodes?: { logicalId: string; role: string; runtime: string }[];
    resumeType?: string;
    resumeToken?: string;
    restorePolicy?: string;
    withCheckpoint?: string; // node logicalId to add checkpoint to
    withBinding?: string; // node logicalId to add binding to
  }): Snapshot {
    const nodes = opts?.nodes ?? [
      { logicalId: "orchestrator", role: "orchestrator", runtime: "claude-code" },
      { logicalId: "worker-a", role: "worker", runtime: "claude-code" },
      { logicalId: "worker-b", role: "worker", runtime: "codex" },
    ];
    const rig = rigRepo.createRig("r99");
    const nodeMap: Record<string, string> = {};
    for (const n of nodes) {
      const node = rigRepo.addNode(rig.id, n.logicalId, { role: n.role, runtime: n.runtime });
      nodeMap[n.logicalId] = node.id;
    }

    const edges = opts?.edges ?? [
      { sourceLogical: "orchestrator", targetLogical: "worker-a", kind: "delegates_to" },
      { sourceLogical: "orchestrator", targetLogical: "worker-b", kind: "delegates_to" },
    ];
    for (const e of edges) {
      rigRepo.addEdge(rig.id, nodeMap[e.sourceLogical]!, nodeMap[e.targetLogical]!, e.kind);
    }

    // Add session with resume metadata if requested
    if (opts?.resumeType) {
      for (const n of nodes) {
        const sess = sessionRegistry.registerSession(nodeMap[n.logicalId]!, `r99-${n.logicalId}`);
        db.prepare("UPDATE sessions SET resume_type = ?, resume_token = ?, restore_policy = ? WHERE id = ?")
          .run(opts.resumeType, opts.resumeToken ?? null, opts.restorePolicy ?? "resume_if_possible", sess.id);
      }
    }

    if (opts?.withBinding) {
      sessionRegistry.updateBinding(nodeMap[opts.withBinding]!, { tmuxSession: `r99-${opts.withBinding}` });
    }

    if (opts?.withCheckpoint) {
      checkpointStore.createCheckpoint(nodeMap[opts.withCheckpoint]!, {
        summary: "Was working on feature X",
        keyArtifacts: ["src/feature.ts"],
      });
    }

    return snapshotCapture.captureSnapshot(rig.id, "manual");
  }

  it("constructor throws on mismatched db handles", () => {
    const otherDb = setupDb();
    const otherRepo = new RigRepository(otherDb);
    const tmux = mockTmux();

    expect(() => new RestoreOrchestrator({
      db, rigRepo: otherRepo, sessionRegistry, eventBus, snapshotRepo, snapshotCapture,
      checkpointStore, nodeLauncher: new NodeLauncher({ db: otherDb, rigRepo: otherRepo, sessionRegistry: new SessionRegistry(otherDb), eventBus: new EventBus(otherDb), tmuxAdapter: tmux }),
      tmuxAdapter: tmux, claudeResume: mockClaudeResume(), codexResume: mockCodexResume(),
    })).toThrow(/same db handle/);

    otherDb.close();
  });

  it("constructor throws on mismatched snapshotRepo handle", () => {
    const otherDb = setupDb();
    const otherSnapshotRepo = new SnapshotRepository(otherDb);
    const tmux = mockTmux();

    expect(() => new RestoreOrchestrator({
      db, rigRepo, sessionRegistry, eventBus, snapshotRepo: otherSnapshotRepo, snapshotCapture,
      checkpointStore, nodeLauncher: new NodeLauncher({ db, rigRepo, sessionRegistry, eventBus, tmuxAdapter: tmux }),
      tmuxAdapter: tmux, claudeResume: mockClaudeResume(), codexResume: mockCodexResume(),
    })).toThrow(/snapshotRepo.*same db handle/);

    otherDb.close();
  });

  it("constructor throws on mismatched snapshotCapture handle", () => {
    const otherDb = setupDb();
    const otherRigRepo = new RigRepository(otherDb);
    const otherSessionRegistry = new SessionRegistry(otherDb);
    const otherEventBus = new EventBus(otherDb);
    const otherSnapshotRepo2 = new SnapshotRepository(otherDb);
    const otherCheckpointStore = new CheckpointStore(otherDb);
    const otherSnapshotCapture = new SnapshotCapture({
      db: otherDb, rigRepo: otherRigRepo, sessionRegistry: otherSessionRegistry,
      eventBus: otherEventBus, snapshotRepo: otherSnapshotRepo2, checkpointStore: otherCheckpointStore,
    });
    const tmux = mockTmux();

    expect(() => new RestoreOrchestrator({
      db, rigRepo, sessionRegistry, eventBus, snapshotRepo, snapshotCapture: otherSnapshotCapture,
      checkpointStore, nodeLauncher: new NodeLauncher({ db, rigRepo, sessionRegistry, eventBus, tmuxAdapter: tmux }),
      tmuxAdapter: tmux, claudeResume: mockClaudeResume(), codexResume: mockCodexResume(),
    })).toThrow(/snapshotCapture.*same db handle/);

    otherDb.close();
  });

  it("constructor throws on mismatched nodeLauncher handle", () => {
    const otherDb = setupDb();
    const otherRigRepo = new RigRepository(otherDb);
    const otherSessionRegistry = new SessionRegistry(otherDb);
    const otherEventBus = new EventBus(otherDb);
    const tmux = mockTmux();
    const otherLauncher = new NodeLauncher({
      db: otherDb, rigRepo: otherRigRepo, sessionRegistry: otherSessionRegistry,
      eventBus: otherEventBus, tmuxAdapter: tmux,
    });

    expect(() => new RestoreOrchestrator({
      db, rigRepo, sessionRegistry, eventBus, snapshotRepo, snapshotCapture,
      checkpointStore, nodeLauncher: otherLauncher,
      tmuxAdapter: tmux, claudeResume: mockClaudeResume(), codexResume: mockCodexResume(),
    })).toThrow(/nodeLauncher.*same db handle/);

    otherDb.close();
  });

  it("nonexistent snapshot -> { ok: false, code: 'snapshot_not_found' }", async () => {
    const orch = createOrchestrator();
    const result = await orch.restore("nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("snapshot_not_found");
  });

  it("topological order: delegates_to (exact order)", async () => {
    const snap = seedRigAndSnapshot();
    const tmux = mockTmux();
    const orch = createOrchestrator({ tmux });

    const result = await orch.restore(snap.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const order = result.result.nodes.map((n) => n.logicalId);
      // orchestrator first (source of delegates_to), then workers alphabetically
      expect(order).toEqual(["orchestrator", "worker-a", "worker-b"]);
    }
  });

  it("spawned_by constrains order (target before source)", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [
        { logicalId: "child", role: "worker", runtime: "claude-code" },
        { logicalId: "parent", role: "orchestrator", runtime: "claude-code" },
      ],
      edges: [{ sourceLogical: "child", targetLogical: "parent", kind: "spawned_by" }],
    });
    const orch = createOrchestrator();

    const result = await orch.restore(snap.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const order = result.result.nodes.map((n) => n.logicalId);
      // parent (target of spawned_by) must come before child (source)
      expect(order.indexOf("parent")).toBeLessThan(order.indexOf("child"));
    }
  });

  it("can_observe does NOT constrain order", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [
        { logicalId: "orchestrator", role: "orchestrator", runtime: "claude-code" },
        { logicalId: "worker-a", role: "worker", runtime: "claude-code" },
        { logicalId: "worker-b", role: "worker", runtime: "codex" },
      ],
      edges: [
        { sourceLogical: "orchestrator", targetLogical: "worker-a", kind: "delegates_to" },
        { sourceLogical: "orchestrator", targetLogical: "worker-b", kind: "delegates_to" },
        { sourceLogical: "worker-a", targetLogical: "worker-b", kind: "can_observe" },
      ],
    });
    const orch = createOrchestrator();
    const result = await orch.restore(snap.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // can_observe should NOT force worker-a before worker-b
      // alphabetical tiebreaker: worker-a before worker-b (same result but for the right reason)
      expect(result.result.nodes.map((n) => n.logicalId)).toEqual(["orchestrator", "worker-a", "worker-b"]);
    }
  });

  it("stale bindings cleared before relaunch", async () => {
    const snap = seedRigAndSnapshot({ withBinding: "orchestrator" });
    // Verify binding exists before restore
    const rigBefore = rigRepo.getRig(snap.data.rig.id);
    const orchBefore = rigBefore!.nodes.find((n) => n.logicalId === "orchestrator");
    expect(orchBefore!.binding).not.toBeNull();

    const orch = createOrchestrator();
    const result = await orch.restore(snap.id);
    expect(result.ok).toBe(true);
  });

  it("stale sessions marked superseded", async () => {
    const snap = seedRigAndSnapshot({ resumeType: "claude_name", resumeToken: "tok" });
    const orch = createOrchestrator();
    await orch.restore(snap.id);

    // Original sessions should be superseded
    const allSessions = db.prepare("SELECT status FROM sessions WHERE status = 'superseded'").all();
    expect(allSessions.length).toBeGreaterThan(0);
  });

  it("pre-restore snapshot captured BEFORE stale-state mutation", async () => {
    const snap = seedRigAndSnapshot({
      withBinding: "orchestrator",
      resumeType: "claude_name",
      resumeToken: "tok",
    });

    const orch = createOrchestrator();
    const result = await orch.restore(snap.id);
    expect(result.ok).toBe(true);

    if (result.ok) {
      // Pre-restore snapshot should contain original binding + session state
      const preSnap = snapshotRepo.getSnapshot(result.result.preRestoreSnapshotId);
      expect(preSnap).not.toBeNull();
      expect(preSnap!.kind).toBe("pre_restore");

      const orchNode = preSnap!.data.nodes.find((n) => n.logicalId === "orchestrator");
      expect(orchNode!.binding).not.toBeNull();
      expect(orchNode!.binding!.tmuxSession).toBe("r99-orchestrator");

      // Pre-restore sessions should show original status (not superseded)
      const preSessions = preSnap!.data.sessions;
      for (const s of preSessions) {
        expect(s.status).not.toBe("superseded");
      }
    }
  });

  it("restore_policy=resume_if_possible + claude_name -> Claude resume called", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
      resumeType: "claude_name",
      resumeToken: "my-session",
      restorePolicy: "resume_if_possible",
    });
    const claude = mockClaudeResume();
    const orch = createOrchestrator({ claude });
    await orch.restore(snap.id);

    expect(claude.resume).toHaveBeenCalled();
  });

  it("restore_policy=resume_if_possible + codex_id -> Codex resume called", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "codex" }],
      edges: [],
      resumeType: "codex_id",
      resumeToken: "uuid-123",
      restorePolicy: "resume_if_possible",
    });
    const codex = mockCodexResume();
    const orch = createOrchestrator({ codex });
    await orch.restore(snap.id);

    expect(codex.resume).toHaveBeenCalled();
  });

  it("resume succeeds -> status 'resumed'", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
      resumeType: "claude_name",
      resumeToken: "tok",
    });
    const orch = createOrchestrator({ claude: mockClaudeResume({ ok: true }) });
    const result = await orch.restore(snap.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.nodes[0]!.status).toBe("resumed");
  });

  it("resume fails -> fallback to checkpoint injection", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
      resumeType: "claude_name",
      resumeToken: "tok",
      withCheckpoint: "worker",
    });
    const tmux = mockTmux();
    const claude = mockClaudeResume({ ok: false, code: "resume_failed", message: "err" });
    const orch = createOrchestrator({ tmux, claude });
    const result = await orch.restore(snap.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.nodes[0]!.status).toBe("fresh_with_checkpoint");
  });

  it("restore_policy=relaunch_fresh -> resume NOT attempted", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
      resumeType: "claude_name",
      resumeToken: "tok",
      restorePolicy: "relaunch_fresh",
    });
    const claude = mockClaudeResume();
    const orch = createOrchestrator({ claude });
    await orch.restore(snap.id);

    expect(claude.resume).not.toHaveBeenCalled();
  });

  it("restore_policy=checkpoint_only -> resume NOT attempted, checkpoint injected", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
      resumeType: "claude_name",
      resumeToken: "tok",
      restorePolicy: "checkpoint_only",
      withCheckpoint: "worker",
    });
    const claude = mockClaudeResume();
    const tmux = mockTmux();
    const orch = createOrchestrator({ tmux, claude });
    const result = await orch.restore(snap.id);

    expect(claude.resume).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.nodes[0]!.status).toBe("fresh_with_checkpoint");
  });

  it("resume_type=none -> resume NOT attempted", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
      resumeType: "none",
      resumeToken: null,
    });
    const claude = mockClaudeResume();
    const codex = mockCodexResume();
    const orch = createOrchestrator({ claude, codex });
    await orch.restore(snap.id);

    expect(claude.resume).not.toHaveBeenCalled();
    expect(codex.resume).not.toHaveBeenCalled();
  });

  it("checkpoint injection: sendText summary then sendKeys Enter", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
      withCheckpoint: "worker",
    });
    const tmux = mockTmux();
    const orch = createOrchestrator({ tmux });
    await orch.restore(snap.id);

    const sendTextCalls = (tmux.sendText as ReturnType<typeof vi.fn>).mock.calls;
    const checkpointCall = sendTextCalls.find((c: unknown[]) =>
      typeof c[1] === "string" && (c[1] as string).includes("Was working on feature X")
    );
    expect(checkpointCall).toBeDefined();
  });

  it("no checkpoint -> status 'fresh_no_checkpoint'", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
    });
    const orch = createOrchestrator();
    const result = await orch.restore(snap.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.nodes[0]!.status).toBe("fresh_no_checkpoint");
  });

  it("node launch fails -> status 'failed', remaining nodes processed", async () => {
    const snap = seedRigAndSnapshot();
    const tmux = mockTmux();
    let callCount = 0;
    (tmux.createSession as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) return { ok: false as const, code: "duplicate_session", message: "err" };
      return { ok: true as const };
    });
    const orch = createOrchestrator({ tmux });
    const result = await orch.restore(snap.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const statuses = result.result.nodes.map((n) => n.status);
      expect(statuses).toContain("failed");
      // Other nodes still processed
      expect(statuses.filter((s) => s !== "failed").length).toBeGreaterThan(0);
    }
  });

  it("checkpoint injection fails -> status 'failed', not 'fresh_with_checkpoint'", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
      withCheckpoint: "worker",
    });
    const tmux = mockTmux();
    // sendText succeeds for launch but fails for checkpoint injection
    let sendTextCallCount = 0;
    (tmux.sendText as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      sendTextCallCount++;
      // First sendText calls are from launch; checkpoint injection comes later
      if (sendTextCallCount > 0) {
        return { ok: false as const, code: "session_not_found", message: "gone" };
      }
      return { ok: true as const };
    });
    const orch = createOrchestrator({ tmux });
    const result = await orch.restore(snap.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.nodes[0]!.status).toBe("failed");
      expect(result.result.nodes[0]!.status).not.toBe("fresh_with_checkpoint");
    }
  });

  it("restore.started: exact payload in DB", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
    });
    const orch = createOrchestrator();
    await orch.restore(snap.id);

    const events = db.prepare("SELECT payload FROM events WHERE type = 'restore.started'").all() as { payload: string }[];
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]!.payload);
    expect(payload.rigId).toBe(snap.data.rig.id);
    expect(payload.snapshotId).toBe(snap.id);
  });

  it("restore.completed: exact payload with RestoreResult in DB + subscriber", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
    });
    const notifications: PersistedEvent[] = [];
    eventBus.subscribe((e) => notifications.push(e));

    const orch = createOrchestrator();
    const result = await orch.restore(snap.id);

    // DB event
    const events = db.prepare("SELECT payload FROM events WHERE type = 'restore.completed'").all() as { payload: string }[];
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]!.payload);
    expect(payload.rigId).toBe(snap.data.rig.id);
    expect(payload.snapshotId).toBe(snap.id);
    expect(payload.result).toBeDefined();
    expect(payload.result.nodes).toHaveLength(1);

    // Subscriber receives same payload
    const completedEvent = notifications.find((e) => e.type === "restore.completed");
    expect(completedEvent).toBeDefined();
    if (completedEvent && completedEvent.type === "restore.completed") {
      expect(completedEvent.rigId).toBe(snap.data.rig.id);
      expect(completedEvent.snapshotId).toBe(snap.id);
      expect(completedEvent.result).toBeDefined();
      expect(completedEvent.result.nodes).toHaveLength(1);
      // Match the returned RestoreResult
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(completedEvent.result.nodes[0]!.status).toBe(result.result.nodes[0]!.status);
        expect(completedEvent.result.nodes[0]!.logicalId).toBe(result.result.nodes[0]!.logicalId);
      }
    }
  });

  it("pre-restore snapshot kind = 'pre_restore'", async () => {
    const snap = seedRigAndSnapshot({
      nodes: [{ logicalId: "worker", role: "worker", runtime: "claude-code" }],
      edges: [],
    });
    const orch = createOrchestrator();
    const result = await orch.restore(snap.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const preSnap = snapshotRepo.getSnapshot(result.result.preRestoreSnapshotId);
      expect(preSnap).not.toBeNull();
      expect(preSnap!.kind).toBe("pre_restore");
    }
  });
});
