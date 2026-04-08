import type { Migration } from "../migrate.js";

export const externalCliAttachmentSchema: Migration = {
  name: "019_external_cli_attachment.sql",
  sql: `
    ALTER TABLE bindings ADD COLUMN attachment_type TEXT NOT NULL DEFAULT 'tmux';
    ALTER TABLE bindings ADD COLUMN external_session_name TEXT;
  `,
};
