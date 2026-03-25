import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createDb } from "../src/db/connection.js";
import { migrate } from "../src/db/migrate.js";
import { coreSchema } from "../src/db/migrations/001_core_schema.js";
import { bindingsSessionsSchema } from "../src/db/migrations/002_bindings_sessions.js";
import { eventsSchema } from "../src/db/migrations/003_events.js";
import { snapshotsSchema } from "../src/db/migrations/004_snapshots.js";
import { checkpointsSchema } from "../src/db/migrations/005_checkpoints.js";
import { resumeMetadataSchema } from "../src/db/migrations/006_resume_metadata.js";
import { nodeSpecFieldsSchema } from "../src/db/migrations/007_node_spec_fields.js";
import { packagesSchema } from "../src/db/migrations/008_packages.js";
import { installJournalSchema } from "../src/db/migrations/009_install_journal.js";
import { PackageRepository } from "../src/domain/package-repository.js";

function setupDb(): Database.Database {
  const db = createDb();
  migrate(db, [
    coreSchema, bindingsSessionsSchema, eventsSchema, snapshotsSchema,
    checkpointsSchema, resumeMetadataSchema, nodeSpecFieldsSchema,
    packagesSchema, installJournalSchema,
  ]);
  return db;
}

describe("PackageRepository", () => {
  let db: Database.Database;
  let repo: PackageRepository;

  beforeEach(() => {
    db = setupDb();
    repo = new PackageRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  // Test 5: createPackage persists ALL fields correctly
  it("createPackage persists and returns all fields", () => {
    const pkg = repo.createPackage({
      name: "test-pkg",
      version: "1.0.0",
      sourceKind: "local_path",
      sourceRef: "/packages/test-pkg",
      manifestHash: "abc123def456",
      summary: "A test package",
    });

    expect(pkg.id).toBeDefined();
    expect(pkg.id.length).toBeGreaterThan(0);
    expect(pkg.name).toBe("test-pkg");
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.sourceKind).toBe("local_path");
    expect(pkg.sourceRef).toBe("/packages/test-pkg");
    expect(pkg.manifestHash).toBe("abc123def456");
    expect(pkg.summary).toBe("A test package");
    expect(pkg.createdAt).toBeDefined();
  });

  // Test 6: findByNameVersion returns correct package
  it("findByNameVersion returns correct package", () => {
    repo.createPackage({
      name: "alpha",
      version: "1.0.0",
      sourceKind: "local_path",
      sourceRef: "/alpha",
      manifestHash: "hash1",
    });
    repo.createPackage({
      name: "beta",
      version: "2.0.0",
      sourceKind: "local_path",
      sourceRef: "/beta",
      manifestHash: "hash2",
      summary: "Beta package",
    });

    const found = repo.findByNameVersion("beta", "2.0.0");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("beta");
    expect(found!.version).toBe("2.0.0");
    expect(found!.summary).toBe("Beta package");

    const notFound = repo.findByNameVersion("gamma", "1.0.0");
    expect(notFound).toBeNull();
  });

  // Test 7: Duplicate name+version -> unique constraint error
  it("duplicate name+version throws unique constraint error", () => {
    repo.createPackage({
      name: "test-pkg",
      version: "1.0.0",
      sourceKind: "local_path",
      sourceRef: "/pkg1",
      manifestHash: "hash1",
    });

    expect(() => {
      repo.createPackage({
        name: "test-pkg",
        version: "1.0.0",
        sourceKind: "local_path",
        sourceRef: "/pkg2",
        manifestHash: "hash2",
      });
    }).toThrow(/UNIQUE/);
  });

  // Test 8: listPackages returns all
  it("listPackages returns all packages", () => {
    repo.createPackage({ name: "a", version: "1.0.0", sourceKind: "local_path", sourceRef: "/a", manifestHash: "h1" });
    repo.createPackage({ name: "b", version: "1.0.0", sourceKind: "local_path", sourceRef: "/b", manifestHash: "h2" });
    repo.createPackage({ name: "c", version: "2.0.0", sourceKind: "local_path", sourceRef: "/c", manifestHash: "h3" });

    const all = repo.listPackages();
    expect(all).toHaveLength(3);
    expect(all.map((p) => p.name).sort()).toEqual(["a", "b", "c"]);
  });

  // Test 10: getPackage by id returns correct Package, nonexistent returns null
  it("getPackage returns by id, null for nonexistent", () => {
    const pkg = repo.createPackage({
      name: "test-pkg",
      version: "1.0.0",
      sourceKind: "local_path",
      sourceRef: "/test",
      manifestHash: "hash",
      summary: "Test",
    });

    const found = repo.getPackage(pkg.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("test-pkg");
    expect(found!.manifestHash).toBe("hash");

    const notFound = repo.getPackage("nonexistent-id");
    expect(notFound).toBeNull();
  });
});
