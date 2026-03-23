import type { Migration } from "../migrate.js";

export const snapshotsSchema: Migration = {
  name: "004_snapshots.sql",
  sql: `
    -- snapshots: hybrid JSON blob + metadata for querying
    -- rig_id is plain TEXT (not FK) — snapshots survive rig deletion
    -- (same append-only history policy as events)
    CREATE TABLE snapshots (
      id          TEXT PRIMARY KEY,
      rig_id      TEXT NOT NULL,
      kind        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'complete',
      data        TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_snapshots_rig ON snapshots(rig_id, created_at);
  `,
};
