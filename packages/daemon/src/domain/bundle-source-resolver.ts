import os from "node:os";
import fs from "node:fs";
import nodePath from "node:path";
import { unpack } from "./bundle-archive.js";
import { parseBundleManifest, validateBundleManifest, normalizeBundleManifest, type BundleManifest } from "./bundle-types.js";
import { resolvePackage } from "./package-resolve-helper.js";
import type { ResolvedPackage, FsOps } from "./package-resolver.js";

/** Result of resolving a bundle for bootstrap consumption */
export interface BundleResolvedSource {
  specPath: string;
  resolvedPackages: ResolvedPackage[];
  /** Map from original ref (as it appears in rig spec package_refs) to resolved package */
  packageRefMap: Record<string, ResolvedPackage>;
  manifest: BundleManifest;
  tempDir: string;
}

/**
 * Resolves a .rigbundle archive into bootstrap-compatible sources.
 * Extracts, verifies, parses manifest, maps vendored packages.
 */
export class BundleSourceResolver {
  private fsOps: FsOps;

  constructor(deps: { fsOps: FsOps }) {
    this.fsOps = deps.fsOps;
  }

  /**
   * Resolve a bundle archive into bootstrap-compatible sources.
   * Caller must call cleanup(tempDir) after use.
   */
  async resolve(bundlePath: string): Promise<BundleResolvedSource> {
    const tempDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "rigbundle-"));

    try {
      // Extract + verify (archive digest + content integrity)
      await unpack(bundlePath, tempDir);

      // Parse bundle manifest
      const manifestPath = nodePath.join(tempDir, "bundle.yaml");
      if (!fs.existsSync(manifestPath)) {
        throw new Error("Extracted bundle missing bundle.yaml");
      }
      const manifestYaml = fs.readFileSync(manifestPath, "utf-8");
      const raw = parseBundleManifest(manifestYaml);

      // Validate manifest (path safety via isRelativeSafePath in validateBundleManifest)
      const validation = validateBundleManifest(raw, { requireIntegrity: false });
      if (!validation.valid) {
        throw new Error(`Invalid bundle manifest: ${validation.errors.join("; ")}`);
      }

      const manifest = normalizeBundleManifest(raw);

      // Locate rig spec — ensure resolved path stays within tempDir
      const specPath = nodePath.resolve(tempDir, manifest.rigSpec);
      if (!specPath.startsWith(nodePath.resolve(tempDir))) {
        throw new Error(`Rig spec path '${manifest.rigSpec}' escapes bundle workspace`);
      }
      if (!fs.existsSync(specPath)) {
        throw new Error(`Rig spec '${manifest.rigSpec}' not found in bundle`);
      }

      // Resolve vendored packages
      const resolvedPackages: ResolvedPackage[] = [];
      const packageRefMap: Record<string, ResolvedPackage> = {};

      for (const entry of manifest.packages) {
        // Ensure package path stays within tempDir
        const vendoredDir = nodePath.resolve(tempDir, entry.path);
        if (!vendoredDir.startsWith(nodePath.resolve(tempDir))) {
          throw new Error(`Package path '${entry.path}' escapes bundle workspace`);
        }
        const result = resolvePackage(vendoredDir, undefined, this.fsOps);

        if (!result.ok) {
          const errMsg = result.kind === "validation" ? result.errors.join("; ") : result.error;
          throw new Error(`Failed to resolve vendored package '${entry.name}': ${errMsg}`);
        }

        resolvedPackages.push(result.resolved);

        // Map all original refs to this resolved package
        packageRefMap[entry.originalSource] = result.resolved;
        if (entry.originalSources) {
          for (const src of entry.originalSources) {
            packageRefMap[src] = result.resolved;
          }
        }
        // Also map by vendored path (for local resolution)
        packageRefMap[entry.path] = result.resolved;
        packageRefMap[`./${entry.path}`] = result.resolved;
      }

      return { specPath, resolvedPackages, packageRefMap, manifest, tempDir };
    } catch (err) {
      // Clean up on failure
      this.cleanup(tempDir);
      throw err;
    }
  }

  /** Remove the temp extraction directory. */
  cleanup(tempDir: string): void {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
