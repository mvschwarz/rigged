import type { Migration } from "../migrate.js";

export const resumeMetadataSchema: Migration = {
  name: "006_resume_metadata.sql",
  sql: `
    -- Resume and restore metadata on sessions (deferred from Phase 1).
    -- These three fields drive the restore decision tree (PRD:472-474):
    --   resume_type: HOW to resume (which CLI command/flag)
    --   resume_token: the actual value to pass
    --   restore_policy: WHETHER to attempt resume at all
    ALTER TABLE sessions ADD COLUMN resume_type TEXT;
    ALTER TABLE sessions ADD COLUMN resume_token TEXT;
    ALTER TABLE sessions ADD COLUMN restore_policy TEXT NOT NULL DEFAULT 'resume_if_possible';
  `,
};
