import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { coreSchema } from "../src/db/migrations/001_core_schema.js";
import { nodeSpecFieldsSchema } from "../src/db/migrations/007_node_spec_fields.js";

describe("007_node_spec_fields", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it("migration adds surface_hint column", () => {
    migrate(db, [coreSchema, nodeSpecFieldsSchema]);
    const cols = db.prepare("PRAGMA table_info(nodes)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("surface_hint");
  });

  it("migration adds workspace column", () => {
    migrate(db, [coreSchema, nodeSpecFieldsSchema]);
    const cols = db.prepare("PRAGMA table_info(nodes)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("workspace");
  });

  it("migration adds restore_policy column", () => {
    migrate(db, [coreSchema, nodeSpecFieldsSchema]);
    const cols = db.prepare("PRAGMA table_info(nodes)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("restore_policy");
  });

  it("migration adds package_refs column", () => {
    migrate(db, [coreSchema, nodeSpecFieldsSchema]);
    const cols = db.prepare("PRAGMA table_info(nodes)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("package_refs");
  });

  it("existing nodes get NULL for all new columns", () => {
    migrate(db, [coreSchema]);
    db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run("rig-1", "r01");
    db.prepare("INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)").run("node-1", "rig-1", "worker");

    migrate(db, [coreSchema, nodeSpecFieldsSchema]);

    const node = db.prepare("SELECT surface_hint, workspace, restore_policy, package_refs FROM nodes WHERE id = ?").get("node-1") as {
      surface_hint: string | null;
      workspace: string | null;
      restore_policy: string | null;
      package_refs: string | null;
    };
    expect(node.surface_hint).toBeNull();
    expect(node.workspace).toBeNull();
    expect(node.restore_policy).toBeNull();
    expect(node.package_refs).toBeNull();
  });
});
