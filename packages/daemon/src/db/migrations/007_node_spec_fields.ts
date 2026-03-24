import type { Migration } from "../migrate.js";

export const nodeSpecFieldsSchema: Migration = {
  name: "007_node_spec_fields.sql",
  sql: `
    -- Extended node fields for RigSpec portability (Phase 3)
    ALTER TABLE nodes ADD COLUMN surface_hint TEXT;
    ALTER TABLE nodes ADD COLUMN workspace TEXT;
    ALTER TABLE nodes ADD COLUMN restore_policy TEXT;
    ALTER TABLE nodes ADD COLUMN package_refs TEXT;  -- JSON array of strings
  `,
};
