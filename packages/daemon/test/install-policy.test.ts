import { describe, it, expect } from "vitest";
import { applyPolicy } from "../src/domain/install-policy.js";
import type { InstallPlanEntry } from "../src/domain/install-planner.js";
import type { RefinedInstallPlan } from "../src/domain/conflict-detector.js";

function makeEntry(overrides: Partial<InstallPlanEntry>): InstallPlanEntry {
  return {
    exportType: "skill",
    exportName: "test",
    classification: "safe_projection",
    targetPath: "/target",
    scope: "project_shared",
    deferred: false,
    ...overrides,
  };
}

function makePlan(
  actionable: InstallPlanEntry[],
  conflicts: InstallPlanEntry[] = [],
  noOps: InstallPlanEntry[] = [],
): RefinedInstallPlan {
  return {
    packageName: "test-pkg",
    packageVersion: "1.0.0",
    sourceRef: "/pkg",
    entries: [...actionable, ...conflicts, ...noOps],
    actionable,
    deferred: [],
    conflicts,
    noOps,
  };
}

describe("InstallPolicy", () => {
  // Test 1: safe_projection -> approved
  it("safe_projection -> approved", () => {
    const entry = makeEntry({ classification: "safe_projection" });
    const plan = makePlan([entry]);
    const result = applyPolicy(plan);

    expect(result.approved).toHaveLength(1);
    expect(result.approved[0]).toBe(entry);
    expect(result.rejected).toHaveLength(0);
  });

  // Test 2: managed_merge without allowMerge -> rejected
  it("managed_merge without allowMerge -> rejected with reason", () => {
    const entry = makeEntry({ classification: "managed_merge", exportType: "guidance" });
    const plan = makePlan([entry]);
    const result = applyPolicy(plan);

    expect(result.approved).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("allowMerge");
  });

  // Test 3: managed_merge with allowMerge -> approved
  it("managed_merge with allowMerge:true -> approved", () => {
    const entry = makeEntry({ classification: "managed_merge", exportType: "guidance" });
    const plan = makePlan([entry]);
    const result = applyPolicy(plan, { allowMerge: true });

    expect(result.approved).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  // Test 4: config_mutation -> rejected 'deferred to Phase 5'
  it("config_mutation -> rejected with 'Phase 5'", () => {
    const entry = makeEntry({ classification: "config_mutation" });
    const plan = makePlan([entry]);
    const result = applyPolicy(plan);

    expect(result.approved).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("Phase 5");
  });

  // Test 5: Mixed plan -> correct split
  it("mixed plan -> correct split of approved and rejected", () => {
    const safe = makeEntry({ exportName: "safe-skill", classification: "safe_projection" });
    const merge = makeEntry({ exportName: "guidance", classification: "managed_merge", exportType: "guidance" });
    const mutation = makeEntry({ exportName: "hook", classification: "config_mutation" });
    const plan = makePlan([safe, merge, mutation]);
    const result = applyPolicy(plan);

    // safe approved, merge + mutation rejected
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0]!.exportName).toBe("safe-skill");
    expect(result.rejected).toHaveLength(2);
  });

  // Test 6: Entry with conflict -> always rejected
  it("entry with conflict -> always rejected regardless of classification", () => {
    const entry = makeEntry({
      classification: "safe_projection",
      conflict: { existingPath: "/existing", reason: "different content" },
    });
    const plan = makePlan([], [entry]); // conflict in conflicts array
    const result = applyPolicy(plan);

    expect(result.approved).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("Conflicts must be resolved");
  });

  // Test 7: external_install -> rejected 'deferred to Phase 5'
  it("external_install -> rejected with 'Phase 5'", () => {
    const entry = makeEntry({ classification: "external_install", exportType: "requirement" });
    const plan = makePlan([entry]);
    const result = applyPolicy(plan);

    expect(result.approved).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toContain("Phase 5");
  });

  // Test 8: Conflict in both actionable + conflicts -> no double-rejection
  it("conflicted entry in both arrays -> rejected exactly once", () => {
    const entry = makeEntry({
      exportName: "overlapping",
      classification: "safe_projection",
      conflict: { existingPath: "/existing", reason: "different content" },
    });
    // Simulate real refined-plan shape where entry appears in both
    const plan = makePlan([entry], [entry]);
    const result = applyPolicy(plan);

    // Must be rejected exactly once, not twice
    const overlappingRejections = result.rejected.filter(
      (r) => r.entry.exportName === "overlapping"
    );
    expect(overlappingRejections).toHaveLength(1);
    expect(overlappingRejections[0]!.reason).toContain("Conflicts must be resolved");
  });
});
