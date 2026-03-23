import Database from "better-sqlite3";

/**
 * Create a SQLite database connection.
 * Defaults to in-memory for tests. Pass a file path for persistence.
 */
export function createDb(filePath?: string): Database.Database {
  const db = new Database(filePath ?? ":memory:");

  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}
