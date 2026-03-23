import type { Migration } from "../migrate.js";

export const eventsSchema: Migration = {
  name: "003_events.sql",
  sql: `
    CREATE TABLE events (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      rig_id      TEXT REFERENCES rigs(id) ON DELETE CASCADE,
      -- INTENTIONALLY NOT AN FK to nodes(id).
      -- Events are an append-only history log. They must survive node deletion
      -- so the full timeline is preserved for replay and audit. An FK with
      -- CASCADE would destroy history; SET NULL would lose the node reference.
      node_id     TEXT,
      type        TEXT NOT NULL,
      payload     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Primary query pattern: "all events for rig X after sequence N" (SSE replay)
    CREATE INDEX idx_events_rig_seq ON events(rig_id, seq);
  `,
};
