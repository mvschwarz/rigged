import type Database from "better-sqlite3";
import { ulid } from "ulid";

export interface Package {
  id: string;
  name: string;
  version: string;
  sourceKind: string;
  sourceRef: string;
  manifestHash: string;
  summary: string | null;
  createdAt: string;
}

interface PackageRow {
  id: string;
  name: string;
  version: string;
  source_kind: string;
  source_ref: string;
  manifest_hash: string;
  summary: string | null;
  created_at: string;
}

export class PackageRepository {
  readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createPackage(opts: {
    name: string;
    version: string;
    sourceKind: string;
    sourceRef: string;
    manifestHash: string;
    summary?: string;
  }): Package {
    const id = ulid();
    this.db
      .prepare(
        "INSERT INTO packages (id, name, version, source_kind, source_ref, manifest_hash, summary) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(id, opts.name, opts.version, opts.sourceKind, opts.sourceRef, opts.manifestHash, opts.summary ?? null);

    return this.getPackage(id)!;
  }

  getPackage(id: string): Package | null {
    const row = this.db
      .prepare("SELECT * FROM packages WHERE id = ?")
      .get(id) as PackageRow | undefined;
    return row ? this.rowToPackage(row) : null;
  }

  findByNameVersion(name: string, version: string): Package | null {
    const row = this.db
      .prepare("SELECT * FROM packages WHERE name = ? AND version = ?")
      .get(name, version) as PackageRow | undefined;
    return row ? this.rowToPackage(row) : null;
  }

  listPackages(): Package[] {
    const rows = this.db
      .prepare("SELECT * FROM packages ORDER BY created_at")
      .all() as PackageRow[];
    return rows.map((r) => this.rowToPackage(r));
  }

  private rowToPackage(row: PackageRow): Package {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      sourceKind: row.source_kind,
      sourceRef: row.source_ref,
      manifestHash: row.manifest_hash,
      summary: row.summary,
      createdAt: row.created_at,
    };
  }
}
