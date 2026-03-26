import type { Migration } from "../migrate.js";

export const bootstrapSchema: Migration = {
  name: "011_bootstrap.sql",
  sql: `
    CREATE TABLE bootstrap_runs (
      id          TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      source_ref  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'planned',
      rig_id      TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      applied_at  TEXT
    );

    CREATE TABLE bootstrap_actions (
      id              TEXT PRIMARY KEY,
      bootstrap_id    TEXT NOT NULL REFERENCES bootstrap_runs(id),
      seq             INTEGER NOT NULL,
      action_kind     TEXT NOT NULL,
      subject_type    TEXT,
      subject_name    TEXT,
      provider        TEXT,
      command_preview  TEXT,
      status          TEXT NOT NULL DEFAULT 'planned',
      detail_json     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_bootstrap_actions ON bootstrap_actions(bootstrap_id, seq);

    CREATE TABLE runtime_verifications (
      id                TEXT PRIMARY KEY,
      runtime           TEXT NOT NULL,
      version           TEXT,
      capabilities_json TEXT,
      verified_at       TEXT NOT NULL DEFAULT (datetime('now')),
      status            TEXT NOT NULL,
      error             TEXT
    );

    ALTER TABLE package_installs ADD COLUMN bootstrap_id TEXT REFERENCES bootstrap_runs(id) ON DELETE SET NULL;
  `,
};
