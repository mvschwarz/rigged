import type {
  PackageManifest,
  SkillExport,
  GuidanceExport,
  AgentExport,
} from "./package-manifest.js";

export interface DeferredExport {
  exportType: "hook" | "mcp";
  source: string;
  reason: string;
}

export interface ResolvedExports {
  skills: SkillExport[];
  guidance: GuidanceExport[];
  agents: AgentExport[];
  deferred: DeferredExport[];
}

/**
 * Resolves package exports, optionally filtered by a role.
 * - When roleName is provided: filters skills/guidance to role references,
 *   keeps all agents, defers hooks referenced by role.
 * - When no roleName: returns all exports, defers all hooks/mcp.
 * - Context references are ignored (human-only docs).
 */
export function resolveExports(
  manifest: PackageManifest,
  roleName?: string
): ResolvedExports {
  const allSkills = manifest.exports.skills ?? [];
  const allGuidance = manifest.exports.guidance ?? [];
  const allAgents = manifest.exports.agents ?? [];
  const allHooks = manifest.exports.hooks ?? [];
  const allMcp = manifest.exports.mcp ?? [];

  // No role → full package
  if (!roleName) {
    const deferred: DeferredExport[] = [
      ...allHooks.map((h) => ({
        exportType: "hook" as const,
        source: h.source,
        reason: "Hooks deferred to Phase 5",
      })),
      ...allMcp.map((m) => ({
        exportType: "mcp" as const,
        source: m.source,
        reason: "MCP deferred to Phase 5",
      })),
    ];

    return {
      skills: allSkills,
      guidance: allGuidance,
      agents: allAgents,
      deferred,
    };
  }

  // Find role
  const role = manifest.roles?.find((r) => r.name === roleName);
  if (!role) {
    throw new Error(`Role '${roleName}' not found in manifest`);
  }

  // Filter skills by role references
  const roleSkillNames = new Set(role.skills ?? []);
  const skills = allSkills.filter((s) => roleSkillNames.has(s.name));

  // Validate all referenced skills exist
  for (const skillRef of role.skills ?? []) {
    if (!allSkills.some((s) => s.name === skillRef)) {
      throw new Error(`Role '${roleName}' references nonexistent skill: '${skillRef}'`);
    }
  }

  // Filter guidance by role references
  const roleGuidanceNames = new Set(role.guidance ?? []);
  const guidance = allGuidance.filter((g) => roleGuidanceNames.has(g.name));

  // Validate all referenced guidance exist
  for (const guidanceRef of role.guidance ?? []) {
    if (!allGuidance.some((g) => g.name === guidanceRef)) {
      throw new Error(`Role '${roleName}' references nonexistent guidance: '${guidanceRef}'`);
    }
  }

  // Agents: always included (all of them) regardless of role
  const agents = allAgents;

  // Hooks: if role specifies hooks, only defer those; otherwise defer all
  const roleHookRefs = new Set(role.hooks ?? []);
  const deferred: DeferredExport[] = [];

  for (const hook of allHooks) {
    if (roleHookRefs.size === 0 || roleHookRefs.has(hook.source)) {
      deferred.push({
        exportType: "hook",
        source: hook.source,
        reason: "Hooks deferred to Phase 5",
      });
    }
  }

  // MCP always deferred
  for (const mcp of allMcp) {
    deferred.push({
      exportType: "mcp",
      source: mcp.source,
      reason: "MCP deferred to Phase 5",
    });
  }

  // Context is explicitly ignored (human-only docs)

  return { skills, guidance, agents, deferred };
}
