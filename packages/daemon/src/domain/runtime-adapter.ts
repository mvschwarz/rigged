import type { Binding, StartupFile } from "./types.js";
import type { ProjectionPlan } from "./projection-planner.js";

// -- Bridge type: NodeBinding extends Binding with cwd --
// Interim repo type. The current repo only has Binding in types.ts.
// The startup orchestrator (AS-T07) constructs NodeBinding from Binding + node.cwd.

export interface NodeBinding extends Binding {
  cwd: string;
}

// -- Resolved startup file with source-root provenance --

export interface ResolvedStartupFile {
  path: string;
  absolutePath: string;
  ownerRoot: string;
  deliveryHint: "auto" | "guidance_merge" | "skill_install" | "send_text";
  required: boolean;
  appliesOn: ("fresh_start" | "restore")[];
}

// -- Adapter result types --

export interface InstalledResource {
  effectiveId: string;
  category: string;
  installedPath: string;
}

export interface ProjectionResult {
  projected: string[];
  skipped: string[];
  failed: Array<{ effectiveId: string; error: string }>;
}

export interface StartupDeliveryResult {
  delivered: number;
  failed: Array<{ path: string; error: string }>;
}

export interface ReadinessResult {
  ready: boolean;
  reason?: string;
}

// -- Runtime adapter contract --

/**
 * The four-method runtime adapter contract for the AgentSpec reboot.
 * Adapters own projection, delivery, reconciliation, and readiness.
 * Startup action execution is NOT part of this contract — that belongs
 * to the startup orchestrator (AS-T07) after checkReady().
 */
export interface RuntimeAdapter {
  readonly runtime: string;

  /** List currently installed/projected resources for a node. */
  listInstalled(binding: NodeBinding): Promise<InstalledResource[]>;

  /** Project resources from a projection plan to the runtime target locations. */
  project(plan: ProjectionPlan, binding: NodeBinding): Promise<ProjectionResult>;

  /** Deliver startup files to the runtime. */
  deliverStartup(files: ResolvedStartupFile[], binding: NodeBinding): Promise<StartupDeliveryResult>;

  /** Check if the runtime harness is responsive and ready. */
  checkReady(binding: NodeBinding): Promise<ReadinessResult>;
}
