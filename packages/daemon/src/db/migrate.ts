import type Database from "better-sqlite3";

export interface Migration {
  name: string;
  sql: string;
}

/**
 * Run migrations against a database.
 * Tracks applied migrations in a schema_migrations table.
 * Skips already-applied migrations. Applies new ones in order.
 */
export function migrate(db: Database.Database, migrations: Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    (
      db
        .prepare("SELECT name FROM schema_migrations")
        .all() as { name: string }[]
    ).map((r) => r.name)
  );

  const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name));

  const applyOne = db.transaction((migration: Migration) => {
    db.exec(migration.sql);
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(
      migration.name
    );
  });

  for (const migration of sorted) {
    if (!applied.has(migration.name)) {
      applyOne(migration);
    }
  }
}
