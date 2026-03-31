import type Database from "better-sqlite3";
import type { SessionRegistry } from "./session-registry.js";
import type { EventBus } from "./event-bus.js";
import type { TmuxAdapter } from "../adapters/tmux.js";
import type { StartupAction } from "./types.js";
import type {
  RuntimeAdapter, NodeBinding, ResolvedStartupFile,
  ProjectionResult, StartupDeliveryResult,
} from "./runtime-adapter.js";
import { resolveConcreteHint } from "./runtime-adapter.js";
import type { ProjectionPlan } from "./projection-planner.js";

// -- Types --

export interface StartupInput {
  rigId: string;
  nodeId: string;
  sessionId: string;
  binding: NodeBinding;
  adapter: RuntimeAdapter;
  plan: ProjectionPlan;
  resolvedStartupFiles: ResolvedStartupFile[];
  startupActions: StartupAction[];
  isRestore: boolean;
  /** Session name for harness launch (used as --name flag). */
  sessionName?: string;
  /** Resume token for restore path. */
  resumeToken?: string;
  /** Skip harness launch (legacy nodes that already resumed via old helpers). */
  skipHarnessLaunch?: boolean;
}

export type StartupResult =
  | { ok: true; startupStatus: "ready" }
  | { ok: false; startupStatus: "failed"; errors: string[] };

interface StartupOrchestratorDeps {
  db: Database.Database;
  sessionRegistry: SessionRegistry;
  eventBus: EventBus;
  tmuxAdapter: TmuxAdapter;
  /** Read file content for concrete-hint resolution. */
  readFile?: (path: string) => string;
}

/**
 * Drives one node from projected resources to startup_status: ready.
 *
 * Sequence:
 * 1. Mark pending, emit node.startup_pending
 * 2. Project resources via adapter
 * 3. Deliver startup files via adapter
 * 4. Execute after_files actions
 * 5. Poll readiness via adapter.checkReady
 * 6. Execute after_ready actions
 * 7. Mark ready, emit node.startup_ready
 *
 * Failure leaves startup_status: failed, node visible.
 * The caller (AS-T08b instantiator) creates session + binding first via NodeLauncher,
 * then calls startNode() with the full startup payload.
 */
export class StartupOrchestrator {
  readonly db: Database.Database;
  private sessionRegistry: SessionRegistry;
  private eventBus: EventBus;
  private tmuxAdapter: TmuxAdapter;

  constructor(deps: StartupOrchestratorDeps) {
    if (deps.db !== deps.sessionRegistry.db) throw new Error("StartupOrchestrator: sessionRegistry must share the same db handle");
    if (deps.db !== deps.eventBus.db) throw new Error("StartupOrchestrator: eventBus must share the same db handle");
    this.db = deps.db;
    this.sessionRegistry = deps.sessionRegistry;
    this.eventBus = deps.eventBus;
    this.tmuxAdapter = deps.tmuxAdapter;
    this.readFile = deps.readFile ?? (() => "");
  }

  private readFile: (path: string) => string;

  async startNode(input: StartupInput): Promise<StartupResult> {
    const errors: string[] = [];

    // 1. Mark pending
    this.sessionRegistry.updateStartupStatus(input.sessionId, "pending");
    this.eventBus.emit({ type: "node.startup_pending", rigId: input.rigId, nodeId: input.nodeId });

    // 2. Project resources
    let projectionResult: ProjectionResult;
    try {
      projectionResult = await input.adapter.project(input.plan, input.binding);
      if (projectionResult.failed.length > 0) {
        for (const f of projectionResult.failed) {
          errors.push(`Projection failed for ${f.effectiveId}: ${f.error}`);
        }
        return this.fail(input, errors);
      }
    } catch (err) {
      errors.push(`Projection error: ${(err as Error).message}`);
      return this.fail(input, errors);
    }

    // 3. Partition startup files by concrete hint: pre-launch (filesystem) vs post-launch (TUI)
    const context = input.isRestore ? "restore" : "fresh_start";
    const applicableFiles = input.resolvedStartupFiles.filter((f) => f.appliesOn.includes(context));
    const preLaunchFiles: ResolvedStartupFile[] = [];
    const postLaunchFiles: ResolvedStartupFile[] = [];
    for (const f of applicableFiles) {
      const hint = f.deliveryHint === "auto"
        ? resolveConcreteHint(f.path, this.safeReadFile(f.absolutePath))
        : f.deliveryHint;
      if (hint === "send_text") {
        postLaunchFiles.push(f);
      } else {
        preLaunchFiles.push(f);
      }
    }

    // 4. Deliver pre-launch files (filesystem: guidance_merge, skill_install)
    if (preLaunchFiles.length > 0) {
      try {
        const deliveryResult = await input.adapter.deliverStartup(preLaunchFiles, input.binding);
        if (deliveryResult.failed.length > 0) {
          for (const f of deliveryResult.failed) {
            errors.push(`Pre-launch file delivery failed: ${f.path}: ${f.error}`);
          }
          return this.fail(input, errors);
        }
      } catch (err) {
        errors.push(`Pre-launch delivery error: ${(err as Error).message}`);
        return this.fail(input, errors);
      }
    }

    // 5. Launch harness (unless skipped for legacy nodes)
    if (!input.skipHarnessLaunch) {
      try {
        const launchResult = await input.adapter.launchHarness(input.binding, {
          name: input.sessionName ?? input.binding.tmuxSession ?? "",
          resumeToken: input.resumeToken,
        });
        if (!launchResult.ok) {
          errors.push(`Harness launch failed: ${launchResult.error}`);
          return this.fail(input, errors);
        }
        // Persist resume token if returned
        if (launchResult.resumeToken && launchResult.resumeType) {
          try {
            this.sessionRegistry.updateResumeToken(input.sessionId, launchResult.resumeType, launchResult.resumeToken);
          } catch { /* best-effort */ }
        }
      } catch (err) {
        errors.push(`Harness launch error: ${(err as Error).message}`);
        return this.fail(input, errors);
      }
    }

    // 6. Check readiness
    // TODO: checkReady is currently a single poll, not a retry loop with timeout.
    // NS-T05 evolves this to a retry loop with backoff and 30s timeout.
    try {
      const readiness = await input.adapter.checkReady(input.binding);
      if (!readiness.ready) {
        errors.push(`Harness not ready: ${readiness.reason ?? "unknown"}`);
        return this.fail(input, errors);
      }
    } catch (err) {
      errors.push(`Readiness check error: ${(err as Error).message}`);
      return this.fail(input, errors);
    }

    // 7. Deliver post-launch files (send_text → TUI, now that harness is ready)
    if (postLaunchFiles.length > 0) {
      try {
        const deliveryResult = await input.adapter.deliverStartup(postLaunchFiles, input.binding);
        if (deliveryResult.failed.length > 0) {
          for (const f of deliveryResult.failed) {
            errors.push(`Post-launch file delivery failed: ${f.path}: ${f.error}`);
          }
          return this.fail(input, errors);
        }
      } catch (err) {
        errors.push(`Post-launch delivery error: ${(err as Error).message}`);
        return this.fail(input, errors);
      }
    }

    // 8. Execute after_files actions
    const afterFilesResult = await this.executeActions(input, "after_files");
    if (!afterFilesResult.ok) {
      return this.fail(input, afterFilesResult.errors);
    }

    // 9. Execute after_ready actions
    const afterReadyResult = await this.executeActions(input, "after_ready");
    if (!afterReadyResult.ok) {
      return this.fail(input, afterReadyResult.errors);
    }

    // 7. Persist startup context for restore replay
    try {
      this.db.prepare(
        "INSERT OR REPLACE INTO node_startup_context (node_id, projection_entries_json, resolved_files_json, startup_actions_json, runtime) VALUES (?, ?, ?, ?, ?)"
      ).run(
        input.nodeId,
        JSON.stringify(input.plan.entries.map((e) => ({ category: e.category, effectiveId: e.effectiveId, sourceSpec: e.sourceSpec, sourcePath: e.sourcePath, resourcePath: e.resourcePath, absolutePath: e.absolutePath, mergeStrategy: e.mergeStrategy, target: e.target }))),
        JSON.stringify(input.resolvedStartupFiles),
        JSON.stringify(input.startupActions),
        input.adapter.runtime,
      );
    } catch { /* best-effort persistence */ }

    // 8. Mark ready
    this.sessionRegistry.updateStartupStatus(input.sessionId, "ready", new Date().toISOString());
    this.eventBus.emit({ type: "node.startup_ready", rigId: input.rigId, nodeId: input.nodeId });

    return { ok: true, startupStatus: "ready" };
  }

  private safeReadFile(path: string): string {
    try { return this.readFile(path); } catch { return ""; }
  }

  private fail(input: StartupInput, errors: string[]): StartupResult {
    this.sessionRegistry.updateStartupStatus(input.sessionId, "failed");
    this.eventBus.emit({
      type: "node.startup_failed",
      rigId: input.rigId,
      nodeId: input.nodeId,
      error: errors.join("; "),
    });
    return { ok: false, startupStatus: "failed", errors };
  }

  private async executeActions(
    input: StartupInput,
    phase: "after_files" | "after_ready",
  ): Promise<{ ok: true } | { ok: false; errors: string[] }> {
    const errors: string[] = [];
    const context = input.isRestore ? "restore" : "fresh_start";

    for (const action of input.startupActions) {
      // Phase filter
      if (action.phase !== phase) continue;

      // appliesOn filter
      if (!action.appliesOn.includes(context)) continue;

      // Non-idempotent actions skipped on restore (retry-as-restore safety)
      if (input.isRestore && !action.idempotent) continue;

      // Execute via tmux
      try {
        if (!input.binding.tmuxSession) {
          errors.push(`No tmux session for action: ${action.value}`);
          continue;
        }

        let text: string;
        if (action.type === "slash_command") {
          text = action.value; // e.g. "/rename implementer"
        } else {
          text = action.value; // send_text: raw text
        }

        const result = await this.tmuxAdapter.sendText(input.binding.tmuxSession, text);
        if (!result.ok) {
          errors.push(`Action failed (${action.type}): ${(result as { message?: string }).message ?? "unknown"}`);
        }
      } catch (err) {
        errors.push(`Action error (${action.type}): ${(err as Error).message}`);
      }
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true };
  }
}
