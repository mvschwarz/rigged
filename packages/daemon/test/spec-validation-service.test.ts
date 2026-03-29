import { describe, it, expect } from "vitest";
import { validateAgentSpecFromYaml, validateRigSpecFromYaml } from "../src/domain/spec-validation-service.js";

describe("Spec validation service", () => {
  // T1: valid AgentSpec passes
  it("valid AgentSpec YAML passes validation", () => {
    const yaml = 'name: test\nversion: "1.0"\nprofiles: {}';
    const result = validateAgentSpecFromYaml(yaml);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  // T2: invalid AgentSpec returns structured errors
  it("invalid AgentSpec YAML returns structured errors", () => {
    const yaml = "summary: no name or version";
    const result = validateAgentSpecFromYaml(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  // T3: valid RigSpec passes
  it("valid RigSpec YAML passes validation", () => {
    const yaml = `
version: "0.2"
name: test-rig
pods:
  - id: dev
    label: Dev
    members:
      - id: impl
        agent_ref: "local:agents/impl"
        profile: default
        runtime: claude-code
        cwd: .
    edges: []
edges: []
`;
    const result = validateRigSpecFromYaml(yaml);
    expect(result.valid).toBe(true);
  });

  // T4: invalid RigSpec returns structured errors
  it("invalid RigSpec YAML returns structured errors", () => {
    const yaml = "name: bad-rig\nversion: '0.2'"; // missing pods
    const result = validateRigSpecFromYaml(yaml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("pods"))).toBe(true);
  });

  // T9: side-effect free
  it("validation services are side-effect free (same input, same output)", () => {
    const yaml = 'name: test\nversion: "1.0"\nprofiles: {}';
    const r1 = validateAgentSpecFromYaml(yaml);
    const r2 = validateAgentSpecFromYaml(yaml);
    expect(r1).toEqual(r2);
  });
});
