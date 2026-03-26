import type Database from "better-sqlite3";
import { ulid } from "ulid";
import type { ExecFn } from "../adapters/tmux.js";
import type { RuntimeVerification, RuntimeStatus } from "./bootstrap-types.js";

interface RuntimeVerifierDeps {
  exec: ExecFn;
  db: Database.Database;
}

/**
 * Verifies runtimes are usable — not just present on PATH.
 * Persists results to runtime_verifications table automatically.
 */
export class RuntimeVerifier {
  readonly db: Database.Database;
  private exec: ExecFn;

  constructor(deps: RuntimeVerifierDeps) {
    this.db = deps.db;
    this.exec = deps.exec;
  }

  /** Verify tmux: `tmux -V`, parse version from output. */
  async verifyTmux(): Promise<RuntimeVerification> {
    const result = await this.runProbe("tmux", async () => {
      const output = await this.exec("tmux -V");
      const version = this.parseVersion(output);
      if (!version) {
        return { status: "error" as RuntimeStatus, version: null, capabilitiesJson: null, error: "unparseable version output" };
      }
      return { status: "verified" as RuntimeStatus, version, capabilitiesJson: null, error: null };
    });
    this.persist(result);
    return result;
  }

  /** Verify cmux: `cmux capabilities --json`, parse capabilities. */
  async verifyCmux(): Promise<RuntimeVerification> {
    const result = await this.runProbe("cmux", async () => {
      const output = await this.exec("cmux capabilities --json");
      const trimmed = output.trim();
      try {
        const parsed = JSON.parse(trimmed);
        const capsJson = JSON.stringify(parsed);
        return { status: "verified" as RuntimeStatus, version: null, capabilitiesJson: capsJson, error: null };
      } catch {
        return { status: "error" as RuntimeStatus, version: null, capabilitiesJson: null, error: "invalid capabilities JSON" };
      }
    }, "degraded");
    this.persist(result);
    return result;
  }

  /** Verify Claude Code: `claude --version`, fallback to `claude --help`. */
  async verifyClaude(): Promise<RuntimeVerification> {
    const result = await this.verifyVersionOrHelp("claude", "claude-code");
    this.persist(result);
    return result;
  }

  /** Verify Codex: `codex --version`, fallback to `codex --help`. */
  async verifyCodex(): Promise<RuntimeVerification> {
    const result = await this.verifyVersionOrHelp("codex", "codex");
    this.persist(result);
    return result;
  }

  /**
   * Verify multiple runtimes. Returns results in input order.
   * @param runtimes - canonical runtime names: 'tmux', 'cmux', 'claude-code', 'codex'
   */
  async verifyAll(runtimes: string[]): Promise<RuntimeVerification[]> {
    const results: RuntimeVerification[] = [];
    for (const runtime of runtimes) {
      switch (runtime) {
        case "tmux": results.push(await this.verifyTmux()); break;
        case "cmux": results.push(await this.verifyCmux()); break;
        case "claude-code": results.push(await this.verifyClaude()); break;
        case "codex": results.push(await this.verifyCodex()); break;
        default: {
          const v = this.buildVerification(runtime, "not_found", null, null, `unknown runtime: ${runtime}`);
          this.persist(v);
          results.push(v);
        }
      }
    }
    return results;
  }

  /**
   * Shared helper: try `{binary} --version`, fall back to `{binary} --help`.
   * Used by verifyClaude and verifyCodex.
   */
  private async verifyVersionOrHelp(binary: string, canonicalName: string): Promise<RuntimeVerification> {
    // Try --version first
    try {
      const output = await this.exec(`${binary} --version`);
      const version = this.parseVersion(output);
      return this.buildVerification(canonicalName, "verified", version ?? null, null, null);
    } catch {
      // Fall back to --help
      try {
        await this.exec(`${binary} --help`);
        return this.buildVerification(canonicalName, "verified", null, null, null);
      } catch {
        return this.buildVerification(canonicalName, "not_found", null, null, `${binary} not found`);
      }
    }
  }

  /**
   * Run a probe with error handling. On exec failure, returns failStatus (default: not_found).
   */
  private async runProbe(
    runtime: string,
    fn: () => Promise<{ status: RuntimeStatus; version: string | null; capabilitiesJson: string | null; error: string | null }>,
    failStatus: RuntimeStatus = "not_found",
  ): Promise<RuntimeVerification> {
    try {
      const { status, version, capabilitiesJson, error } = await fn();
      return this.buildVerification(runtime, status, version, capabilitiesJson, error);
    } catch (err) {
      return this.buildVerification(runtime, failStatus, null, null, (err as Error).message);
    }
  }

  private buildVerification(
    runtime: string,
    status: RuntimeStatus,
    version: string | null,
    capabilitiesJson: string | null,
    error: string | null,
  ): RuntimeVerification {
    return {
      id: ulid(),
      runtime,
      version,
      capabilitiesJson,
      verifiedAt: new Date().toISOString(),
      status,
      error,
    };
  }

  /** Parse a semver-like version from output (e.g. "tmux 3.4" -> "3.4"). */
  private parseVersion(output: string): string | undefined {
    const match = output.match(/(\d+\.\d+(?:\.\d+)?(?:[a-z])?)/);
    return match?.[1];
  }

  /** Persist verification to runtime_verifications table. Upserts by runtime name. */
  private persist(v: RuntimeVerification): void {
    const existing = this.db
      .prepare("SELECT id FROM runtime_verifications WHERE runtime = ?")
      .get(v.runtime) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(
        "UPDATE runtime_verifications SET version = ?, capabilities_json = ?, verified_at = ?, status = ?, error = ? WHERE runtime = ?"
      ).run(v.version, v.capabilitiesJson, v.verifiedAt, v.status, v.error, v.runtime);
      v.id = existing.id;
    } else {
      this.db.prepare(
        "INSERT INTO runtime_verifications (id, runtime, version, capabilities_json, verified_at, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(v.id, v.runtime, v.version, v.capabilitiesJson, v.verifiedAt, v.status, v.error);
    }
  }
}
