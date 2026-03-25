import path from "node:path";
import { createHash } from "node:crypto";
import {
  parseManifest,
  validateManifest,
  normalizeManifest,
  type PackageManifest,
} from "./package-manifest.js";

export interface ResolvedPackage {
  sourceKind: "local_path";
  sourceRef: string;
  manifest: PackageManifest;
  manifestHash: string;
  rawManifestYaml: string;
}

export interface FsOps {
  readFile: (filePath: string) => string;
  exists: (filePath: string) => boolean;
  listFiles?: (dirPath: string) => string[]; // relative paths of files in dir
}

export class PackageResolver {
  private fs: FsOps;

  constructor(fs: FsOps) {
    this.fs = fs;
  }

  resolve(sourceRef: string, cwd?: string): ResolvedPackage {
    // Resolve to absolute path
    const absoluteRef = path.isAbsolute(sourceRef)
      ? sourceRef
      : path.resolve(cwd ?? process.cwd(), sourceRef);

    const manifestPath = path.join(absoluteRef, "package.yaml");

    if (!this.fs.exists(manifestPath)) {
      throw new Error(`No package.yaml found at ${manifestPath}`);
    }

    const rawYaml = this.fs.readFile(manifestPath);
    const raw = parseManifest(rawYaml);
    const validation = validateManifest(raw);

    if (!validation.valid) {
      throw new Error(`Invalid manifest: ${validation.errors.join("; ")}`);
    }

    const manifest = normalizeManifest(raw);
    const manifestHash = createHash("sha256").update(rawYaml).digest("hex");

    return {
      sourceKind: "local_path",
      sourceRef: absoluteRef,
      manifest,
      manifestHash,
      rawManifestYaml: rawYaml,
    };
  }
}
