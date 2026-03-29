import { describe, it, expect, vi } from "vitest";
import { createFullTestDb } from "./helpers/test-app.js";
import { RigRepository } from "../src/domain/rig-repository.js";
import { PodRepository } from "../src/domain/pod-repository.js";
import { SessionRegistry } from "../src/domain/session-registry.js";
import { EventBus } from "../src/domain/event-bus.js";
import { NodeLauncher } from "../src/domain/node-launcher.js";
import { StartupOrchestrator } from "../src/domain/startup-orchestrator.js";
import { PodRigInstantiator } from "../src/domain/rigspec-instantiator.js";
import { RigSpecCodec } from "../src/domain/rigspec-codec.js";
import type { AgentResolverFsOps } from "../src/domain/agent-resolver.js";
import type { RuntimeAdapter } from "../src/domain/runtime-adapter.js";
import type { TmuxAdapter } from "../src/adapters/tmux.js";
import type { RigSpec } from "../src/domain/types.js";

function mockTmux(): TmuxAdapter {
  return {
    createSession: vi.fn(async () => ({ ok: true as const })),
    killSession: vi.fn(async () => ({ ok: true as const })),
    sendText: vi.fn(async () => ({ ok: true as const })),
    hasSession: vi.fn(async () => true),
    listSessions: vi.fn(async () => []),
    listWindows: vi.fn(async () => []),
    listPanes: vi.fn(async () => []),
    sendKeys: vi.fn(async () => ({ ok: true as const })),
  } as unknown as TmuxAdapter;
}

function mockAdapter(): RuntimeAdapter {
  return {
    runtime: "claude-code",
    listInstalled: vi.fn(async () => []),
    project: vi.fn(async () => ({ projected: [], skipped: [], failed: [] })),
    deliverStartup: vi.fn(async () => ({ delivered: 0, failed: [] })),
    checkReady: vi.fn(async () => ({ ready: true })),
  };
}

function mockFs(files: Record<string, string>): AgentResolverFsOps {
  return {
    readFile: (p: string) => { if (p in files) return files[p]!; throw new Error(`Not found: ${p}`); },
    exists: (p: string) => p in files,
  };
}

const RIG_ROOT = "/project/rigs/my-rig";

function agentYaml(name: string): string {
  return `name: ${name}\nversion: "1.0.0"\nresources:\n  skills: []\nprofiles:\n  default:\n    uses:\n      skills: []`;
}

function makeRigSpec(overrides?: Partial<RigSpec>): RigSpec {
  return {
    version: "0.2", name: "test-rig",
    pods: [{ id: "dev", label: "Dev", members: [{ id: "impl", agentRef: "local:agents/impl", profile: "default", runtime: "claude-code", cwd: "." }], edges: [] }],
    edges: [],
    ...overrides,
  };
}

describe("PodRigInstantiator", () => {
  function setup(fsFiles?: Record<string, string>) {
    const db = createFullTestDb();
    const rigRepo = new RigRepository(db);
    const podRepo = new PodRepository(db);
    const sessionRegistry = new SessionRegistry(db);
    const eventBus = new EventBus(db);
    const tmux = mockTmux();
    const nodeLauncher = new NodeLauncher({ db, rigRepo, sessionRegistry, eventBus, tmuxAdapter: tmux });
    const startupOrch = new StartupOrchestrator({ db, sessionRegistry, eventBus, tmuxAdapter: tmux });
    const adapter = mockAdapter();
    const files = fsFiles ?? { [`${RIG_ROOT}/agents/impl/agent.yaml`]: agentYaml("impl") };
    const fsOps = mockFs(files);

    const inst = new PodRigInstantiator({
      db, rigRepo, podRepo, sessionRegistry, eventBus, nodeLauncher, startupOrchestrator: startupOrch,
      fsOps, adapters: { "claude-code": adapter, "codex": mockAdapter() },
    });

    return { db, rigRepo, podRepo, sessionRegistry, eventBus, inst, adapter, tmux };
  }

  // T1: valid rig instantiates pods + nodes + edges
  it("instantiates pods + nodes correctly", async () => {
    const { db, inst } = setup();
    const yaml = RigSpecCodec.serialize(makeRigSpec());
    const result = await inst.instantiate(yaml, RIG_ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.rigId).toBeDefined();
      expect(result.result.nodes).toHaveLength(1);
    }
    db.close();
  });

  // T2: resolved spec identity persisted
  it("persists resolved spec identity on node", async () => {
    const { db, rigRepo, inst } = setup();
    const yaml = RigSpecCodec.serialize(makeRigSpec());
    const result = await inst.instantiate(yaml, RIG_ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rig = rigRepo.getRig(result.result.rigId);
      const node = rig!.nodes[0]!;
      expect(node.resolvedSpecName).toBe("impl");
      expect(node.resolvedSpecVersion).toBe("1.0.0");
      expect(node.resolvedSpecHash).toBeTruthy();
    }
    db.close();
  });

  // T3: startup orchestrator called
  it("calls startup orchestrator with adapter", async () => {
    const { db, inst, adapter } = setup();
    const yaml = RigSpecCodec.serialize(makeRigSpec());
    const result = await inst.instantiate(yaml, RIG_ROOT);
    expect(result.ok).toBe(true);
    expect(adapter.project).toHaveBeenCalled();
    expect(adapter.checkReady).toHaveBeenCalled();
    db.close();
  });

  // T4: partial failure — one node startup fails, other succeeds
  it("partial node startup failure does not corrupt other nodes", async () => {
    const files = {
      [`${RIG_ROOT}/agents/impl/agent.yaml`]: agentYaml("impl"),
      [`${RIG_ROOT}/agents/qa/agent.yaml`]: agentYaml("qa"),
    };

    const db = createFullTestDb();
    const rigRepo = new RigRepository(db);
    const podRepo = new PodRepository(db);
    const sessionRegistry = new SessionRegistry(db);
    const eventBus = new EventBus(db);
    const tmux = mockTmux();
    const nodeLauncher = new NodeLauncher({ db, rigRepo, sessionRegistry, eventBus, tmuxAdapter: tmux });

    // Startup orchestrator that fails for qa
    const startupOrch = new StartupOrchestrator({ db, sessionRegistry, eventBus, tmuxAdapter: tmux });
    const origStartNode = startupOrch.startNode.bind(startupOrch);
    let callCount = 0;
    startupOrch.startNode = async (input) => {
      callCount++;
      if (callCount === 2) {
        // Fail the second node's startup
        sessionRegistry.updateStartupStatus(input.sessionId, "failed");
        return { ok: false, startupStatus: "failed", errors: ["simulated failure"] };
      }
      return origStartNode(input);
    };

    const adapter = mockAdapter();
    const fsOps = mockFs(files);
    const inst = new PodRigInstantiator({
      db, rigRepo, podRepo, sessionRegistry, eventBus, nodeLauncher,
      startupOrchestrator: startupOrch, fsOps,
      adapters: { "claude-code": adapter },
    });

    const spec = makeRigSpec({
      pods: [{
        id: "dev", label: "Dev",
        members: [
          { id: "impl", agentRef: "local:agents/impl", profile: "default", runtime: "claude-code", cwd: "." },
          { id: "qa", agentRef: "local:agents/qa", profile: "default", runtime: "claude-code", cwd: "." },
        ],
        edges: [],
      }],
    });
    const yaml = RigSpecCodec.serialize(spec);
    const result = await inst.instantiate(yaml, RIG_ROOT);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const launched = result.result.nodes.filter((n) => n.status === "launched");
      const failed = result.result.nodes.filter((n) => n.status === "failed");
      expect(launched.length).toBe(1);
      expect(failed.length).toBe(1);
    }
    db.close();
  });

  // T5: same DB handle shared
  it("validates same DB handle", () => {
    const db = createFullTestDb();
    const db2 = createFullTestDb();
    const rigRepo = new RigRepository(db);
    expect(() => new PodRigInstantiator({
      db: db2, rigRepo, podRepo: new PodRepository(db2), sessionRegistry: new SessionRegistry(db2),
      eventBus: new EventBus(db2), nodeLauncher: new NodeLauncher({ db: db2, rigRepo: new RigRepository(db2), sessionRegistry: new SessionRegistry(db2), eventBus: new EventBus(db2), tmuxAdapter: mockTmux() }),
      startupOrchestrator: new StartupOrchestrator({ db: db2, sessionRegistry: new SessionRegistry(db2), eventBus: new EventBus(db2), tmuxAdapter: mockTmux() }),
      fsOps: mockFs({}), adapters: {},
    })).toThrow(/same db handle/);
    db.close();
    db2.close();
  });

  // T7: emits startup lifecycle events
  it("emits startup lifecycle events", async () => {
    const { db, eventBus, inst } = setup();
    const events: string[] = [];
    eventBus.subscribe((e) => events.push(e.type));
    const yaml = RigSpecCodec.serialize(makeRigSpec());
    await inst.instantiate(yaml, RIG_ROOT);
    expect(events).toContain("node.startup_pending");
    expect(events).toContain("node.startup_ready");
    db.close();
  });

  // T8: pod membership persisted
  it("persists pod membership on nodes", async () => {
    const { db, rigRepo, inst } = setup();
    const yaml = RigSpecCodec.serialize(makeRigSpec());
    const result = await inst.instantiate(yaml, RIG_ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rig = rigRepo.getRig(result.result.rigId);
      expect(rig!.nodes[0]!.podId).toBeTruthy();
    }
    db.close();
  });

  // CP2-R1: Two pods with same member name create distinct nodes (qualified logical_id)
  it("two pods with same member name create distinct nodes", async () => {
    const files = {
      [`${RIG_ROOT}/agents/impl/agent.yaml`]: agentYaml("impl"),
    };
    const { db, rigRepo, inst } = setup(files);
    const spec = makeRigSpec({
      pods: [
        { id: "dev", label: "Dev", members: [{ id: "impl", agentRef: "local:agents/impl", profile: "default", runtime: "claude-code", cwd: "." }], edges: [] },
        { id: "arch", label: "Arch", members: [{ id: "impl", agentRef: "local:agents/impl", profile: "default", runtime: "claude-code", cwd: "." }], edges: [] },
      ],
    });
    const yaml = RigSpecCodec.serialize(spec);
    const result = await inst.instantiate(yaml, RIG_ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rig = rigRepo.getRig(result.result.rigId);
      expect(rig!.nodes).toHaveLength(2);
      const logicalIds = rig!.nodes.map((n) => n.logicalId).sort();
      expect(logicalIds).toEqual(["arch.impl", "dev.impl"]);
    }
    db.close();
  });

  // CP2-R2: Narrowed restore-policy persisted to both node and session
  it("persists narrowed restore-policy to node and session", async () => {
    // Agent spec has checkpoint_only default, member requests resume_if_possible (broadening — should fail)
    // Instead: spec has resume_if_possible, member narrows to relaunch_fresh
    const narrowingAgent = `name: impl\nversion: "1.0.0"\ndefaults:\n  lifecycle:\n    compaction_strategy: harness_native\n    restore_policy: resume_if_possible\nresources:\n  skills: []\nprofiles:\n  default:\n    uses:\n      skills: []`;
    const files = { [`${RIG_ROOT}/agents/impl/agent.yaml`]: narrowingAgent };
    const { db, rigRepo, sessionRegistry, inst } = setup(files);
    const spec = makeRigSpec({
      pods: [{ id: "dev", label: "Dev", members: [{ id: "impl", agentRef: "local:agents/impl", profile: "default", runtime: "claude-code", cwd: ".", restorePolicy: "relaunch_fresh" }], edges: [] }],
    });
    const yaml = RigSpecCodec.serialize(spec);
    const result = await inst.instantiate(yaml, RIG_ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rig = rigRepo.getRig(result.result.rigId);
      expect(rig!.nodes[0]!.restorePolicy).toBe("relaunch_fresh");
      // Check session too
      const sessions = sessionRegistry.getSessionsForRig(result.result.rigId);
      expect(sessions[0]!.restorePolicy).toBe("relaunch_fresh");
    }
    db.close();
  });

  // CP2-R3: Topological ordering enforced (delegates_to edge)
  it("launches nodes in topological order based on edges", async () => {
    const files = {
      [`${RIG_ROOT}/agents/impl/agent.yaml`]: agentYaml("impl"),
      [`${RIG_ROOT}/agents/orch/agent.yaml`]: agentYaml("orch"),
    };
    const { db, inst } = setup(files);
    const spec = makeRigSpec({
      pods: [{
        id: "dev", label: "Dev",
        members: [
          { id: "worker", agentRef: "local:agents/impl", profile: "default", runtime: "claude-code", cwd: "." },
          { id: "lead", agentRef: "local:agents/orch", profile: "default", runtime: "claude-code", cwd: "." },
        ],
        edges: [{ kind: "delegates_to", from: "lead", to: "worker" }],
      }],
    });
    const yaml = RigSpecCodec.serialize(spec);
    const result = await inst.instantiate(yaml, RIG_ROOT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // lead should be launched before worker (delegates_to: lead -> worker means lead first)
      const leadIdx = result.result.nodes.findIndex((n) => n.logicalId === "dev.lead");
      const workerIdx = result.result.nodes.findIndex((n) => n.logicalId === "dev.worker");
      expect(leadIdx).toBeLessThan(workerIdx);
    }
    db.close();
  });
});
