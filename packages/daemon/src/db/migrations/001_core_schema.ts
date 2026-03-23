import type { Migration } from "../migrate.js";

export const coreSchema: Migration = {
  name: "001_core_schema.sql",
  sql: `
    -- rigs: top-level topology container
    CREATE TABLE rigs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- nodes: logical identity within a rig
    -- id = opaque DB primary key (ulid). All FKs reference this.
    -- logical_id = logical name from rig spec (e.g. "orchestrator"). Human-facing.
    CREATE TABLE nodes (
      id          TEXT PRIMARY KEY,
      rig_id      TEXT NOT NULL REFERENCES rigs(id) ON DELETE CASCADE,
      logical_id  TEXT NOT NULL,
      role        TEXT,
      runtime     TEXT,
      model       TEXT,
      cwd         TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(rig_id, logical_id)
    );

    -- edges: relationships between nodes
    CREATE TABLE edges (
      id          TEXT PRIMARY KEY,
      rig_id      TEXT NOT NULL REFERENCES rigs(id) ON DELETE CASCADE,
      source_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id   TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Edge integrity: source and target must belong to the same rig.
    -- SQLite CHECK cannot cross-reference tables, so we use a trigger.
    CREATE TRIGGER edge_same_rig_insert
    BEFORE INSERT ON edges
    BEGIN
      SELECT RAISE(ABORT, 'edge source and target must belong to the same rig')
      WHERE (SELECT rig_id FROM nodes WHERE id = NEW.source_id)
         != (SELECT rig_id FROM nodes WHERE id = NEW.target_id);
      SELECT RAISE(ABORT, 'edge rig_id must match source node rig_id')
      WHERE NEW.rig_id != (SELECT rig_id FROM nodes WHERE id = NEW.source_id);
    END;
  `,
};
