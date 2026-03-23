import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { coreSchema } from "../src/db/migrations/001_core_schema.js";
import { bindingsSessionsSchema } from "../src/db/migrations/002_bindings_sessions.js";
import { resumeMetadataSchema } from "../src/db/migrations/006_resume_metadata.js";

function seedNode(db: Database.Database) {
  db.prepare("INSERT INTO rigs (id, name) VALUES (?, ?)").run("rig-1", "r01");
  db.prepare("INSERT INTO nodes (id, rig_id, logical_id) VALUES (?, ?, ?)").run("node-1", "rig-1", "worker");
}

describe("006_resume_metadata", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  it("migration adds resume_type column to sessions", () => {
    migrate(db, [coreSchema, bindingsSessionsSchema, resumeMetadataSchema]);
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("resume_type");
  });

  it("migration adds resume_token column to sessions", () => {
    migrate(db, [coreSchema, bindingsSessionsSchema, resumeMetadataSchema]);
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("resume_token");
  });

  it("migration adds restore_policy column to sessions", () => {
    migrate(db, [coreSchema, bindingsSessionsSchema, resumeMetadataSchema]);
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("restore_policy");
  });

  it("existing sessions get NULL resume_type/resume_token after migration", () => {
    // Apply base schema, seed a session, THEN apply resume migration
    migrate(db, [coreSchema, bindingsSessionsSchema]);
    seedNode(db);
    db.prepare(
      "INSERT INTO sessions (id, node_id, session_name, status) VALUES (?, ?, ?, ?)"
    ).run("sess-pre", "node-1", "r01-worker", "running");

    // Now apply the resume migration
    migrate(db, [coreSchema, bindingsSessionsSchema, resumeMetadataSchema]);

    const sess = db.prepare("SELECT resume_type, resume_token FROM sessions WHERE id = ?").get("sess-pre") as {
      resume_type: string | null;
      resume_token: string | null;
    };
    expect(sess.resume_type).toBeNull();
    expect(sess.resume_token).toBeNull();
  });

  it("existing sessions get 'resume_if_possible' restore_policy after migration", () => {
    migrate(db, [coreSchema, bindingsSessionsSchema]);
    seedNode(db);
    db.prepare(
      "INSERT INTO sessions (id, node_id, session_name, status) VALUES (?, ?, ?, ?)"
    ).run("sess-pre", "node-1", "r01-worker", "running");

    migrate(db, [coreSchema, bindingsSessionsSchema, resumeMetadataSchema]);

    const sess = db.prepare("SELECT restore_policy FROM sessions WHERE id = ?").get("sess-pre") as {
      restore_policy: string;
    };
    expect(sess.restore_policy).toBe("resume_if_possible");
  });

  it("restore_policy defaults to 'resume_if_possible' for new inserts", () => {
    migrate(db, [coreSchema, bindingsSessionsSchema, resumeMetadataSchema]);
    seedNode(db);
    db.prepare(
      "INSERT INTO sessions (id, node_id, session_name) VALUES (?, ?, ?)"
    ).run("sess-1", "node-1", "r01-worker");

    const sess = db.prepare("SELECT restore_policy FROM sessions WHERE id = ?").get("sess-1") as {
      restore_policy: string;
    };
    expect(sess.restore_policy).toBe("resume_if_possible");
  });

  it("insert session with all three fields, query returns them", () => {
    migrate(db, [coreSchema, bindingsSessionsSchema, resumeMetadataSchema]);
    seedNode(db);
    db.prepare(
      "INSERT INTO sessions (id, node_id, session_name, resume_type, resume_token, restore_policy) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("sess-1", "node-1", "r01-worker", "claude_name", "my-session-token", "checkpoint_only");

    const sess = db.prepare("SELECT resume_type, resume_token, restore_policy FROM sessions WHERE id = ?").get("sess-1") as {
      resume_type: string;
      resume_token: string;
      restore_policy: string;
    };
    expect(sess.resume_type).toBe("claude_name");
    expect(sess.resume_token).toBe("my-session-token");
    expect(sess.restore_policy).toBe("checkpoint_only");
  });
});
