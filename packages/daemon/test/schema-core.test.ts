import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { coreSchema } from "../src/db/migrations/001_core_schema.js";

describe("001_core_schema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
    migrate(db, [coreSchema]);
  });

  afterEach(() => {
    db.close();
  });

  it("creates rigs, nodes, and edges tables", () => {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("rigs");
    expect(names).toContain("nodes");
    expect(names).toContain("edges");
  });

  it("can insert a rig", () => {
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run(
      "rig-1",
      "test-rig"
    );
    const rig = db.prepare("SELECT * FROM rigs WHERE id = ?").get("rig-1") as {
      id: string;
      name: string;
    };
    expect(rig.name).toBe("test-rig");
  });

  it("can insert nodes referencing a rig", () => {
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run(
      "rig-1",
      "test-rig"
    );
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id, role, runtime) VALUES (?, ?, ?, ?, ?)"
    ).run("node-1", "rig-1", "orchestrator", "orchestrator", "claude-code");

    const node = db
      .prepare("SELECT * FROM nodes WHERE id = ?")
      .get("node-1") as { logical_id: string; role: string };
    expect(node.logical_id).toBe("orchestrator");
    expect(node.role).toBe("orchestrator");
  });

  it("enforces FK: node must reference valid rig", () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
        )
        .run("node-1", "nonexistent-rig", "worker")
    ).toThrow();
  });

  it("enforces unique (rig_id, logical_id)", () => {
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run(
      "rig-1",
      "test-rig"
    );
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
    ).run("node-1", "rig-1", "worker");

    expect(() =>
      db
        .prepare(
          "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
        )
        .run("node-2", "rig-1", "worker")
    ).toThrow();
  });

  it("can insert edges referencing valid nodes", () => {
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run(
      "rig-1",
      "test-rig"
    );
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
    ).run("node-1", "rig-1", "orchestrator");
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
    ).run("node-2", "rig-1", "worker");

    db.prepare(
      "INSERT INTO edges (id, rig_id, source_id, target_id, kind) VALUES (?, ?, ?, ?, ?)"
    ).run("edge-1", "rig-1", "node-1", "node-2", "delegates_to");

    const edge = db
      .prepare("SELECT * FROM edges WHERE id = ?")
      .get("edge-1") as { kind: string };
    expect(edge.kind).toBe("delegates_to");
  });

  it("enforces FK: edge must reference valid nodes", () => {
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run(
      "rig-1",
      "test-rig"
    );
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
    ).run("node-1", "rig-1", "orchestrator");

    expect(() =>
      db
        .prepare(
          "INSERT INTO edges (id, rig_id, source_id, target_id, kind) VALUES (?, ?, ?, ?, ?)"
        )
        .run("edge-1", "rig-1", "node-1", "nonexistent", "delegates_to")
    ).toThrow();
  });

  it("rejects edges where source and target belong to different rigs", () => {
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run(
      "rig-1",
      "rig-one"
    );
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run(
      "rig-2",
      "rig-two"
    );
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
    ).run("node-1", "rig-1", "worker-a");
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
    ).run("node-2", "rig-2", "worker-b");

    expect(() =>
      db
        .prepare(
          "INSERT INTO edges (id, rig_id, source_id, target_id, kind) VALUES (?, ?, ?, ?, ?)"
        )
        .run("edge-1", "rig-1", "node-1", "node-2", "delegates_to")
    ).toThrow(/same rig/);
  });

  it("rejects edges where rig_id does not match source node rig_id", () => {
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run(
      "rig-1",
      "rig-one"
    );
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run(
      "rig-2",
      "rig-two"
    );
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
    ).run("node-1", "rig-1", "worker-a");
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
    ).run("node-2", "rig-1", "worker-b");

    // Nodes are in rig-1 but edge claims rig-2
    expect(() =>
      db
        .prepare(
          "INSERT INTO edges (id, rig_id, source_id, target_id, kind) VALUES (?, ?, ?, ?, ?)"
        )
        .run("edge-1", "rig-2", "node-1", "node-2", "delegates_to")
    ).toThrow(/rig_id must match/);
  });

  it("cascade deletes: deleting a rig removes its nodes and edges", () => {
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run(
      "rig-1",
      "test-rig"
    );
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
    ).run("node-1", "rig-1", "orchestrator");
    db.prepare(
      "INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)"
    ).run("node-2", "rig-1", "worker");
    db.prepare(
      "INSERT INTO edges (id, rig_id, source_id, target_id, kind) VALUES (?, ?, ?, ?, ?)"
    ).run("edge-1", "rig-1", "node-1", "node-2", "delegates_to");

    db.prepare("DELETE FROM rigs WHERE id = ?").run("rig-1");

    const nodes = db.prepare("SELECT * FROM nodes").all();
    const edges = db.prepare("SELECT * FROM edges").all();
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});
