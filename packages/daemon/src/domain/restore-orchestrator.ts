import type Database from "better-sqlite3";
import type { RigRepository } from "./rig-repository.js";
import type { SessionRegistry } from "./session-registry.js";
import type { EventBus } from "./event-bus.js";
import type { SnapshotRepository } from "./snapshot-repository.js";
import type { SnapshotCapture } from "./snapshot-capture.js";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { NodeLauncher } from "./node-launcher.js";
import type { TmuxAdapter } from "../adapters/tmux.js";
import type { ClaudeResumeAdapter } from "../adapters/claude-resume.js";
import type { CodexResumeAdapter } from "../adapters/codex-resume.js";
import type {
  RestoreOutcome,
  RestoreResult,
  RestoreNodeResult,
  SnapshotData,
  NodeWithBinding,
  Edge,
  Session,
  Checkpoint,
} from "./types.js";

// Only these edge kinds constrain launch order
const LAUNCH_DEPENDENCY_KINDS = new Set(["delegates_to", "spawned_by"]);

interface RestoreOrchestratorDeps {
  db: Database.Database;
  rigRepo: RigRepository;
  sessionRegistry: SessionRegistry;
  eventBus: EventBus;
  snapshotRepo: SnapshotRepository;
  snapshotCapture: SnapshotCapture;
  checkpointStore: CheckpointStore;
  nodeLauncher: NodeLauncher;
  tmuxAdapter: TmuxAdapter;
  claudeResume: ClaudeResumeAdapter;
  codexResume: CodexResumeAdapter;
}

export class RestoreOrchestrator {
  readonly db: Database.Database;
  private rigRepo: RigRepository;
  private sessionRegistry: SessionRegistry;
  private eventBus: EventBus;
  private snapshotRepo: SnapshotRepository;
  private snapshotCapture: SnapshotCapture;
  private nodeLauncher: NodeLauncher;
  private tmuxAdapter: TmuxAdapter;
  private claudeResume: ClaudeResumeAdapter;
  private codexResume: CodexResumeAdapter;

  constructor(deps: RestoreOrchestratorDeps) {
    if (deps.db !== deps.rigRepo.db) {
      throw new Error("RestoreOrchestrator: rigRepo must share the same db handle");
    }
    if (deps.db !== deps.sessionRegistry.db) {
      throw new Error("RestoreOrchestrator: sessionRegistry must share the same db handle");
    }
    if (deps.db !== deps.eventBus.db) {
      throw new Error("RestoreOrchestrator: eventBus must share the same db handle");
    }
    if (deps.db !== deps.snapshotRepo.db) {
      throw new Error("RestoreOrchestrator: snapshotRepo must share the same db handle");
    }
    if (deps.db !== deps.checkpointStore.db) {
      throw new Error("RestoreOrchestrator: checkpointStore must share the same db handle");
    }
    if (deps.db !== deps.snapshotCapture.db) {
      throw new Error("RestoreOrchestrator: snapshotCapture must share the same db handle");
    }
    if (deps.db !== deps.nodeLauncher.db) {
      throw new Error("RestoreOrchestrator: nodeLauncher must share the same db handle");
    }

    this.db = deps.db;
    this.rigRepo = deps.rigRepo;
    this.sessionRegistry = deps.sessionRegistry;
    this.eventBus = deps.eventBus;
    this.snapshotRepo = deps.snapshotRepo;
    this.snapshotCapture = deps.snapshotCapture;
    this.nodeLauncher = deps.nodeLauncher;
    this.tmuxAdapter = deps.tmuxAdapter;
    this.claudeResume = deps.claudeResume;
    this.codexResume = deps.codexResume;
  }

  async restore(snapshotId: string): Promise<RestoreOutcome> {
    // 1. Load snapshot
    const snapshot = this.snapshotRepo.getSnapshot(snapshotId);
    if (!snapshot) {
      return { ok: false, code: "snapshot_not_found", message: `Snapshot ${snapshotId} not found` };
    }

    const rigId = snapshot.rigId;
    const rig = this.rigRepo.getRig(rigId);
    if (!rig) {
      return { ok: false, code: "rig_not_found", message: `Rig ${rigId} not found` };
    }

    try {
      // 2. Capture pre-restore snapshot BEFORE any mutations
      const preRestoreSnapshot = this.snapshotCapture.captureSnapshot(rigId, "pre_restore");

      // 3. Emit restore.started
      this.eventBus.emit({ type: "restore.started", rigId, snapshotId });

      // 4. Compute restore plan
      const plan = this.computeRestorePlan(snapshot.data);

      // 5. Execute restore with compensating pattern per node
      const nodeResults: RestoreNodeResult[] = [];
      for (const entry of plan) {
        const result = await this.restoreNodeWithCompensation(entry, rigId, snapshot.data);
        nodeResults.push(result);
      }

      const restoreResult: RestoreResult = {
        snapshotId,
        preRestoreSnapshotId: preRestoreSnapshot.id,
        nodes: nodeResults,
      };

      // 7. Emit restore.completed
      this.eventBus.emit({ type: "restore.completed", rigId, snapshotId, result: restoreResult });

      return { ok: true, result: restoreResult };
    } catch (err) {
      return {
        ok: false,
        code: "restore_error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private captureNodeState(nodeId: string, rigId: string): { binding: import("./types.js").Binding | null; sessions: { id: string; status: string }[] } {
    const binding = this.sessionRegistry.getBindingForNode(nodeId);
    const sessions = this.sessionRegistry.getSessionsForRig(rigId)
      .filter((s) => s.nodeId === nodeId && s.status !== "superseded" && s.status !== "exited")
      .map((s) => ({ id: s.id, status: s.status }));
    return { binding, sessions };
  }

  private clearStaleState(nodeId: string, rigId: string): void {
    this.sessionRegistry.clearBinding(nodeId);
    const sessions = this.sessionRegistry.getSessionsForRig(rigId);
    for (const sess of sessions) {
      if (sess.nodeId === nodeId && sess.status !== "superseded" && sess.status !== "exited") {
        this.sessionRegistry.markSuperseded(sess.id);
      }
    }
  }

  private restoreNodeState(nodeId: string, priorState: { binding: import("./types.js").Binding | null; sessions: { id: string; status: string }[] }): void {
    // Restore prior binding
    if (priorState.binding) {
      this.sessionRegistry.updateBinding(nodeId, {
        tmuxSession: priorState.binding.tmuxSession ?? undefined,
        tmuxWindow: priorState.binding.tmuxWindow ?? undefined,
        tmuxPane: priorState.binding.tmuxPane ?? undefined,
        cmuxWorkspace: priorState.binding.cmuxWorkspace ?? undefined,
        cmuxSurface: priorState.binding.cmuxSurface ?? undefined,
      });
    }
    // Restore prior session statuses
    for (const sess of priorState.sessions) {
      this.sessionRegistry.updateStatus(sess.id, sess.status);
    }
  }

  private computeRestorePlan(data: SnapshotData): PlanEntry[] {
    const nodes = data.nodes;
    const edges = data.edges;

    // Build adjacency for launch-dependency edges only
    // For delegates_to: source must launch before target
    // For spawned_by: target must launch before source
    const nodeIds = nodes.map((n) => n.id);
    const inDegree: Record<string, number> = {};
    const adjacency: Record<string, string[]> = {};

    for (const id of nodeIds) {
      inDegree[id] = 0;
      adjacency[id] = [];
    }

    for (const edge of edges) {
      if (!LAUNCH_DEPENDENCY_KINDS.has(edge.kind)) continue;

      let from: string;
      let to: string;

      if (edge.kind === "delegates_to") {
        from = edge.sourceId;
        to = edge.targetId;
      } else {
        // spawned_by: target (parent) must launch before source (child)
        from = edge.targetId;
        to = edge.sourceId;
      }

      if (adjacency[from] && inDegree[to] !== undefined) {
        adjacency[from]!.push(to);
        inDegree[to] = (inDegree[to] ?? 0) + 1;
      }
    }

    // Topological sort with alphabetical tiebreaker by logical_id
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const queue = nodeIds
      .filter((id) => (inDegree[id] ?? 0) === 0)
      .sort((a, b) => {
        const na = nodeById.get(a)!.logicalId;
        const nb = nodeById.get(b)!.logicalId;
        return na.localeCompare(nb);
      });

    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);

      const neighbors = (adjacency[current] ?? []).slice().sort((a, b) => {
        const na = nodeById.get(a)!.logicalId;
        const nb = nodeById.get(b)!.logicalId;
        return na.localeCompare(nb);
      });

      for (const neighbor of neighbors) {
        inDegree[neighbor] = (inDegree[neighbor] ?? 1) - 1;
        if ((inDegree[neighbor] ?? 0) === 0) {
          // Insert in sorted position
          const logicalId = nodeById.get(neighbor)!.logicalId;
          let inserted = false;
          for (let i = 0; i < queue.length; i++) {
            if (nodeById.get(queue[i]!)!.logicalId.localeCompare(logicalId) > 0) {
              queue.splice(i, 0, neighbor);
              inserted = true;
              break;
            }
          }
          if (!inserted) queue.push(neighbor);
        }
      }
    }

    return order.map((id) => ({
      node: nodeById.get(id)!,
    }));
  }

  private async restoreNodeWithCompensation(
    entry: PlanEntry,
    rigId: string,
    data: SnapshotData
  ): Promise<RestoreNodeResult> {
    const node = entry.node;
    const nodeId = node.id;

    // Capture prior state for compensation
    const priorState = this.captureNodeState(nodeId, rigId);

    // Clear stale state so NodeLauncher doesn't see already_bound
    this.clearStaleState(nodeId, rigId);

    // Attempt launch — compensate ONLY if launch itself fails
    const launchResult = await this.nodeLauncher.launchNode(rigId, node.logicalId);
    if (!launchResult.ok) {
      // Launch failed — restore prior state (compensating action)
      this.restoreNodeState(nodeId, priorState);
      return {
        nodeId,
        logicalId: node.logicalId,
        status: "failed",
        error: launchResult.message,
      };
    }

    // Launch succeeded — do NOT compensate on post-launch failures
    // (the new session/binding are now the current state)
    return this.postLaunchRestore(entry, rigId, data, launchResult.sessionName);
  }

  private async postLaunchRestore(
    entry: PlanEntry,
    rigId: string,
    data: SnapshotData,
    sessionName: string
  ): Promise<RestoreNodeResult> {
    const node = entry.node;
    const session = data.sessions.find((s) => s.nodeId === node.id) ?? null;
    const checkpoint = data.checkpoints[node.id] ?? null;

    // Check restore policy
    const restorePolicy = session?.restorePolicy ?? "resume_if_possible";
    const resumeType = session?.resumeType ?? null;
    const resumeToken = session?.resumeToken ?? null;

    if (restorePolicy === "resume_if_possible" && resumeType && resumeType !== "none") {
      // Attempt resume
      const resumed = await this.attemptResume(sessionName, resumeType, resumeToken, node.cwd ?? "/");
      if (resumed) {
        return { nodeId: node.id, logicalId: node.logicalId, status: "resumed" };
      }
    }

    // Fall through to checkpoint injection
    if (checkpoint) {
      const injected = await this.injectCheckpoint(sessionName, checkpoint);
      if (!injected) {
        return { nodeId: node.id, logicalId: node.logicalId, status: "failed", error: "Checkpoint injection failed" };
      }
      return { nodeId: node.id, logicalId: node.logicalId, status: "fresh_with_checkpoint" };
    }

    return { nodeId: node.id, logicalId: node.logicalId, status: "fresh_no_checkpoint" };
  }

  private async attemptResume(
    sessionName: string,
    resumeType: string,
    resumeToken: string | null,
    cwd: string
  ): Promise<boolean> {
    if (this.claudeResume.canResume(resumeType, resumeToken)) {
      const result = await this.claudeResume.resume(sessionName, resumeType, resumeToken, cwd);
      return result.ok;
    }

    if (this.codexResume.canResume(resumeType, resumeToken)) {
      const result = await this.codexResume.resume(sessionName, resumeType, resumeToken, cwd);
      return result.ok;
    }

    return false;
  }

  private async injectCheckpoint(sessionName: string, checkpoint: Checkpoint): Promise<boolean> {
    const summary = `Resume context: ${checkpoint.summary}`;
    const textResult = await this.tmuxAdapter.sendText(sessionName, summary);
    if (!textResult.ok) return false;
    const keyResult = await this.tmuxAdapter.sendKeys(sessionName, ["Enter"]);
    if (!keyResult.ok) return false;
    return true;
  }
}

interface PlanEntry {
  node: NodeWithBinding;
}
