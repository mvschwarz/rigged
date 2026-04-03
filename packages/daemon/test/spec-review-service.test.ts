import { describe, it, expect } from "vitest";
import { SpecReviewService } from "../src/domain/spec-review-service.js";

const POD_AWARE_YAML = `
version: "0.2"
name: review-rig
summary: A test review rig
pods:
  - id: dev
    label: Development
    members:
      - id: impl
        agent_ref: "local:agents/impl"
        runtime: claude-code
        profile: default
        cwd: /tmp/dev
      - id: qa
        agent_ref: "local:agents/qa"
        runtime: codex
        profile: default
        cwd: /tmp/qa
    edges:
      - kind: delegates_to
        from: impl
        to: qa
  - id: orch
    label: Orchestration
    members:
      - id: lead
        agent_ref: "local:agents/lead"
        runtime: claude-code
        profile: orchestrator
        cwd: /tmp/orch
edges:
  - kind: delegates_to
    from: orch.lead
    to: dev.impl
`;

const LEGACY_YAML = `
version: "1.0"
name: legacy-rig
nodes:
  - id: worker-a
    runtime: claude-code
    role: worker
  - id: worker-b
    runtime: codex
    role: reviewer
edges:
  - from: worker-a
    to: worker-b
    kind: delegates_to
`;

const AGENT_YAML = `
name: impl-agent
version: "1.0"
description: Implementation agent for TDD
defaults:
  runtime: claude-code
profiles:
  default:
    uses: []
  orchestrator:
    uses: []
resources:
  skills:
    - id: tdd
      path: skills/tdd.md
  guidance:
    - id: culture
      path: guidance/culture.md
startup:
  files:
    - path: role.md
      required: true
  actions:
    - type: slash_command
      value: /test-driven-development
      idempotent: true
`;

describe("SpecReviewService", () => {
  const svc = new SpecReviewService();

  it("reviewRigSpec pod-aware returns structured pods/members/edges + graph", () => {
    const result = svc.reviewRigSpec(POD_AWARE_YAML, "draft");

    expect(result.kind).toBe("rig");
    expect(result.sourceState).toBe("draft");
    expect(result.name).toBe("review-rig");
    expect(result.format).toBe("pod_aware");
    if (result.format !== "pod_aware") throw new Error("wrong format");

    expect(result.pods).toHaveLength(2);
    expect(result.pods[0]!.id).toBe("dev");
    expect(result.pods[0]!.members).toHaveLength(2);
    expect(result.pods[0]!.members[0]!.agentRef).toBe("local:agents/impl");

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]!.from).toBe("orch.lead");

    // Graph
    expect(result.graph.nodes).toHaveLength(3);
    expect(result.graph.edges.length).toBeGreaterThan(0);
    // Graph nodes should have pod grouping
    const implNode = result.graph.nodes.find((n) => n.id === "dev.impl");
    expect(implNode).toBeDefined();
    expect(implNode!.pod).toBe("dev");
  });

  it("reviewRigSpec legacy returns structured nodes/edges + graph", () => {
    const result = svc.reviewRigSpec(LEGACY_YAML, "file_preview");

    expect(result.kind).toBe("rig");
    expect(result.sourceState).toBe("file_preview");
    expect(result.format).toBe("legacy");
    if (result.format !== "legacy") throw new Error("wrong format");

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]!.id).toBe("worker-a");
    expect(result.nodes[0]!.runtime).toBe("claude-code");

    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);
  });

  it("reviewRigSpec invalid YAML throws with validation errors", () => {
    expect(() => svc.reviewRigSpec("name: test\n", "draft")).toThrow();
  });

  it("reviewAgentSpec returns profiles, resources, startup", () => {
    const result = svc.reviewAgentSpec(AGENT_YAML, "draft");

    expect(result.kind).toBe("agent");
    expect(result.sourceState).toBe("draft");
    expect(result.name).toBe("impl-agent");
    expect(result.description).toBe("Implementation agent for TDD");

    expect(result.profiles).toHaveLength(2);
    expect(result.profiles[0]!.name).toBe("default");

    expect(result.resources.skills).toHaveLength(1);
    expect(result.resources.guidance).toHaveLength(1);

    expect(result.startup.files).toHaveLength(1);
    expect(result.startup.actions).toHaveLength(1);
  });

  it("reviewAgentSpec invalid YAML throws with validation errors", () => {
    expect(() => svc.reviewAgentSpec("foo: bar\n", "draft")).toThrow();
  });
});
