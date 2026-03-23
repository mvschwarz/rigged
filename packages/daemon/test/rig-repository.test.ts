import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { coreSchema } from "../src/db/migrations/001_core_schema.js";
import { bindingsSessionsSchema } from "../src/db/migrations/002_bindings_sessions.js";
import { RigRepository } from "../src/domain/rig-repository.js";

function setupDb(): Database.Database {
  const db = createDb();
  migrate(db, [coreSchema, bindingsSessionsSchema]);
  return db;
}

describe("RigRepository", () => {
  let db: Database.Database;
  let repo: RigRepository;

  beforeEach(() => {
    db = setupDb();
    repo = new RigRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("createRig persists and returns typed Rig with id", () => {
    const rig = repo.createRig("test-rig");
    expect(rig.id).toBeDefined();
    expect(typeof rig.id).toBe("string");
    expect(rig.id.length).toBeGreaterThan(0);
    expect(rig.name).toBe("test-rig");
    expect(rig.createdAt).toBeDefined();
  });

  it("addNode persists with rig FK, returns typed Node", () => {
    const rig = repo.createRig("test-rig");
    const node = repo.addNode(rig.id, "orchestrator", {
      role: "orchestrator",
      runtime: "claude-code",
      model: "opus",
    });
    expect(node.id).toBeDefined();
    expect(node.rigId).toBe(rig.id);
    expect(node.logicalId).toBe("orchestrator");
    expect(node.role).toBe("orchestrator");
    expect(node.runtime).toBe("claude-code");
    expect(node.model).toBe("opus");
  });

  it("addNode to nonexistent rig throws", () => {
    expect(() => repo.addNode("nonexistent", "worker")).toThrow();
  });

  it("addNode with duplicate logical_id in same rig throws", () => {
    const rig = repo.createRig("test-rig");
    repo.addNode(rig.id, "worker");
    expect(() => repo.addNode(rig.id, "worker")).toThrow();
  });

  it("addEdge validates both nodes exist and belong to same rig", () => {
    const rig = repo.createRig("test-rig");
    const n1 = repo.addNode(rig.id, "orchestrator");
    const n2 = repo.addNode(rig.id, "worker");
    const edge = repo.addEdge(rig.id, n1.id, n2.id, "delegates_to");
    expect(edge.id).toBeDefined();
    expect(edge.sourceId).toBe(n1.id);
    expect(edge.targetId).toBe(n2.id);
    expect(edge.kind).toBe("delegates_to");
  });

  it("addEdge cross-rig rejected", () => {
    const rig1 = repo.createRig("rig-one");
    const rig2 = repo.createRig("rig-two");
    const n1 = repo.addNode(rig1.id, "worker-a");
    const n2 = repo.addNode(rig2.id, "worker-b");
    expect(() =>
      repo.addEdge(rig1.id, n1.id, n2.id, "delegates_to")
    ).toThrow(/same rig/);
  });

  it("getRig returns full graph with nodes, edges, and bindings", () => {
    const rig = repo.createRig("test-rig");
    const n1 = repo.addNode(rig.id, "orchestrator", { role: "orchestrator" });
    const n2 = repo.addNode(rig.id, "worker", { role: "worker" });
    repo.addEdge(rig.id, n1.id, n2.id, "delegates_to");

    // Add a binding to n1 only
    db.prepare(
      "INSERT INTO bindings (id, node_id, tmux_session) VALUES (?, ?, ?)"
    ).run("bind-1", n1.id, "r01-orch1-lead");

    const full = repo.getRig(rig.id);
    expect(full).not.toBeNull();
    expect(full!.rig.name).toBe("test-rig");
    expect(full!.nodes).toHaveLength(2);
    expect(full!.edges).toHaveLength(1);
    expect(full!.edges[0]!.kind).toBe("delegates_to");

    // n1 has a binding
    const orchNode = full!.nodes.find((n) => n.logicalId === "orchestrator");
    expect(orchNode!.binding).not.toBeNull();
    expect(orchNode!.binding!.tmuxSession).toBe("r01-orch1-lead");
  });

  it("getRig: unbound nodes have binding: null (not undefined/omitted)", () => {
    const rig = repo.createRig("test-rig");
    repo.addNode(rig.id, "worker");

    const full = repo.getRig(rig.id);
    const workerNode = full!.nodes.find((n) => n.logicalId === "worker");
    // Must be explicitly null, not undefined
    expect(workerNode).toHaveProperty("binding");
    expect(workerNode!.binding).toBeNull();
  });

  it("listRigs returns all rigs", () => {
    repo.createRig("rig-a");
    repo.createRig("rig-b");
    repo.createRig("rig-c");
    const rigs = repo.listRigs();
    expect(rigs).toHaveLength(3);
    const names = rigs.map((r) => r.name);
    expect(names).toContain("rig-a");
    expect(names).toContain("rig-b");
    expect(names).toContain("rig-c");
  });

  it("deleteRig cascades — nodes and edges gone", () => {
    const rig = repo.createRig("test-rig");
    const n1 = repo.addNode(rig.id, "orchestrator");
    const n2 = repo.addNode(rig.id, "worker");
    repo.addEdge(rig.id, n1.id, n2.id, "delegates_to");

    repo.deleteRig(rig.id);

    expect(repo.getRig(rig.id)).toBeNull();
    expect(repo.listRigs()).toHaveLength(0);
  });
});
