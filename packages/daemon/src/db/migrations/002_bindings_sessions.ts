import type { Migration } from "../migrate.js";

export const bindingsSessionsSchema: Migration = {
  name: "002_bindings_sessions.sql",
  sql: `
    -- bindings: how a node attaches to physical surfaces
    -- A node MAY have zero or one binding (unbound = not yet materialized)
    CREATE TABLE bindings (
      id              TEXT PRIMARY KEY,
      node_id         TEXT NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE CASCADE,
      tmux_session    TEXT,
      tmux_window     TEXT,
      tmux_pane       TEXT,
      cmux_workspace  TEXT,
      cmux_surface    TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- sessions: live harness execution state
    -- NOTE: resume_token deferred to Phase 2 migration
    CREATE TABLE sessions (
      id              TEXT PRIMARY KEY,
      node_id         TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      session_name    TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'unknown',
      last_seen_at    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `,
};
