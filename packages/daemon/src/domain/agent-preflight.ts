import { resolveAgentRef, type AgentResolverFsOps } from "./agent-resolver.js";
import type { PreflightResult } from "./types.js";

/**
 * Agent-only preflight: resolves agent_ref and its imports.
 * Does NOT check runtime (that's member-authoritative in rig preflight).
 * @param agentRef - agent_ref string
 * @param rigRoot - rig root directory
 * @param fsOps - filesystem operations
 * @returns PreflightResult with errors/warnings
 */
export function agentPreflight(
  agentRef: string,
  rigRoot: string,
  fsOps: AgentResolverFsOps,
): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const result = resolveAgentRef(agentRef, rigRoot, fsOps);
  if (!result.ok) {
    if (result.code === "validation_failed") {
      errors.push(...(result as { errors: string[] }).errors);
    } else {
      errors.push((result as { error: string }).error);
    }
    return { ready: false, errors, warnings };
  }

  // Import collisions as warnings (non-fatal)
  for (const col of result.collisions) {
    if (col.sources.length >= 2) {
      const hasBase = col.sources.some((s) => s.qualifiedId === col.resourceId);
      if (hasBase) {
        warnings.push(`Base/import collision in ${col.category}: "${col.resourceId}" — base keeps unqualified id, import addressable as ${col.sources.find((s) => s.qualifiedId !== col.resourceId)?.qualifiedId}`);
      } else {
        warnings.push(`Import/import collision in ${col.category}: "${col.resourceId}" — use qualified ids: ${col.sources.map((s) => s.qualifiedId).join(", ")}`);
      }
    }
  }

  return { ready: errors.length === 0, errors, warnings };
}
