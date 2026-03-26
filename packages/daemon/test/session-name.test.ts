import { describe, it, expect } from "vitest";
import { deriveSessionName, validateSessionName } from "../src/domain/session-name.js";

describe("session-name", () => {
  it("preserves managed rig stems that already match rNN-", () => {
    expect(deriveSessionName("r01", "orchestrator")).toBe("r01-orchestrator");
    expect(validateSessionName("r01-orchestrator")).toBe(true);
  });

  it("normalizes ordinary rig names into a managed r00- stem", () => {
    const derived = deriveSessionName("qa-dogfood-rig", "dev");
    expect(derived).toBe("r00-qa-dogfood-rig-dev");
    expect(validateSessionName(derived)).toBe(true);
  });
});
