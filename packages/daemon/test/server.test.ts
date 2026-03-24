import { describe, it, expect } from "vitest";
import { createFullTestDb, createTestApp } from "./helpers/test-app.js";
import { RigRepository } from "../src/domain/rig-repository.js";
import { SessionRegistry } from "../src/domain/session-registry.js";
import { EventBus } from "../src/domain/event-bus.js";
import { NodeLauncher } from "../src/domain/node-launcher.js";
import { SnapshotRepository } from "../src/domain/snapshot-repository.js";
import { CheckpointStore } from "../src/domain/checkpoint-store.js";
import { SnapshotCapture } from "../src/domain/snapshot-capture.js";
import { RestoreOrchestrator } from "../src/domain/restore-orchestrator.js";
import { ClaudeResumeAdapter } from "../src/adapters/claude-resume.js";
import { CodexResumeAdapter } from "../src/adapters/codex-resume.js";
import { createApp } from "../src/server.js";
import { mockTmuxAdapter, unavailableCmuxAdapter } from "./helpers/test-app.js";

function buildFullDeps(db: ReturnType<typeof createFullTestDb>, overrides?: { snapshotRepo?: SnapshotRepository; snapshotCapture?: SnapshotCapture; restoreOrchestrator?: RestoreOrchestrator }) {
  const rigRepo = new RigRepository(db);
  const sessionRegistry = new SessionRegistry(db);
  const eventBus = new EventBus(db);
  const tmux = mockTmuxAdapter();
  const cmux = unavailableCmuxAdapter();
  const nodeLauncher = new NodeLauncher({ db, rigRepo, sessionRegistry, eventBus, tmuxAdapter: tmux });
  const snapshotRepo = overrides?.snapshotRepo ?? new SnapshotRepository(db);
  const checkpointStore = new CheckpointStore(db);
  const snapshotCapture = overrides?.snapshotCapture ?? new SnapshotCapture({ db, rigRepo, sessionRegistry, eventBus, snapshotRepo, checkpointStore });
  const claudeResume = new ClaudeResumeAdapter(tmux);
  const codexResume = new CodexResumeAdapter(tmux);
  const restoreOrchestrator = overrides?.restoreOrchestrator ?? new RestoreOrchestrator({
    db, rigRepo, sessionRegistry, eventBus, snapshotRepo, snapshotCapture,
    checkpointStore, nodeLauncher, tmuxAdapter: tmux, claudeResume, codexResume,
  });
  return { rigRepo, sessionRegistry, eventBus, nodeLauncher, tmuxAdapter: tmux, cmuxAdapter: cmux, snapshotCapture, snapshotRepo, restoreOrchestrator };
}

describe("Hono server (production app)", () => {
  it("GET /healthz returns 200 with status ok", async () => {
    const db = createFullTestDb();
    const { app } = createTestApp(db);
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
    db.close();
  });

  it("GET /unknown returns 404", async () => {
    const db = createFullTestDb();
    const { app } = createTestApp(db);
    const res = await app.request("/unknown");
    expect(res.status).toBe(404);
    db.close();
  });

  it("production app mounts /api/rigs (not healthz-only)", async () => {
    const db = createFullTestDb();
    const { app } = createTestApp(db);
    const res = await app.request("/api/rigs");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    db.close();
  });

  it("createApp throws if rigRepo and eventBus use different db handles", () => {
    const db1 = createFullTestDb();
    const db2 = createFullTestDb();

    const deps = buildFullDeps(db1);
    deps.eventBus = new EventBus(db2);

    expect(() => createApp(deps)).toThrow(/same db handle/);

    db1.close();
    db2.close();
  });

  it("createApp throws if snapshotRepo uses different db handle", () => {
    const db1 = createFullTestDb();
    const db2 = createFullTestDb();

    // Build valid deps on db1, then swap snapshotRepo to db2
    const deps = buildFullDeps(db1);
    (deps as Record<string, unknown>).snapshotRepo = new SnapshotRepository(db2);

    expect(() => createApp(deps)).toThrow(/snapshotRepo.*same db handle/);

    db1.close();
    db2.close();
  });

  it("createApp throws if snapshotCapture uses different db handle", () => {
    const db1 = createFullTestDb();
    const db2 = createFullTestDb();

    // Build a self-consistent snapshotCapture on db2
    const r2 = new RigRepository(db2);
    const s2 = new SessionRegistry(db2);
    const e2 = new EventBus(db2);
    const sr2 = new SnapshotRepository(db2);
    const cs2 = new CheckpointStore(db2);
    const otherCapture = new SnapshotCapture({ db: db2, rigRepo: r2, sessionRegistry: s2, eventBus: e2, snapshotRepo: sr2, checkpointStore: cs2 });

    // Build valid deps on db1, then swap snapshotCapture to db2
    const deps = buildFullDeps(db1);
    (deps as Record<string, unknown>).snapshotCapture = otherCapture;

    expect(() => createApp(deps)).toThrow(/snapshotCapture.*same db handle/);

    db1.close();
    db2.close();
  });

  it("createApp throws if restoreOrchestrator uses different db handle", () => {
    const db1 = createFullTestDb();
    const db2 = createFullTestDb();

    // Build a self-consistent orchestrator on db2
    const r2 = new RigRepository(db2);
    const s2 = new SessionRegistry(db2);
    const e2 = new EventBus(db2);
    const sr2 = new SnapshotRepository(db2);
    const cs2 = new CheckpointStore(db2);
    const cap2 = new SnapshotCapture({ db: db2, rigRepo: r2, sessionRegistry: s2, eventBus: e2, snapshotRepo: sr2, checkpointStore: cs2 });
    const tmux2 = mockTmuxAdapter();
    const nl2 = new NodeLauncher({ db: db2, rigRepo: r2, sessionRegistry: s2, eventBus: e2, tmuxAdapter: tmux2 });
    const otherOrch = new RestoreOrchestrator({
      db: db2, rigRepo: r2, sessionRegistry: s2, eventBus: e2,
      snapshotRepo: sr2, snapshotCapture: cap2, checkpointStore: cs2,
      nodeLauncher: nl2, tmuxAdapter: tmux2,
      claudeResume: new ClaudeResumeAdapter(tmux2), codexResume: new CodexResumeAdapter(tmux2),
    });

    // Build valid deps on db1, then swap restoreOrchestrator to db2
    const deps = buildFullDeps(db1);
    (deps as Record<string, unknown>).restoreOrchestrator = otherOrch;

    expect(() => createApp(deps)).toThrow(/restoreOrchestrator.*same db handle/);

    db1.close();
    db2.close();
  });
});
