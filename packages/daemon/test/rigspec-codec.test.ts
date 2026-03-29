import { describe, it, expect } from "vitest";
import { RigSpecCodec, LegacyRigSpecCodec } from "../src/domain/rigspec-codec.js";
import { RigSpecSchema } from "../src/domain/rigspec-schema.js";
import type { RigSpec } from "../src/domain/types.js";

const VALID_RIG: RigSpec = {
  version: "0.2",
  name: "dev-rig",
  summary: "Dev rig",
  cultureFile: "culture.md",
  pods: [
    {
      id: "dev",
      label: "Development",
      members: [
        { id: "impl", agentRef: "local:agents/impl", profile: "tdd", runtime: "claude-code", cwd: "." },
        { id: "qa", agentRef: "local:agents/qa", profile: "reviewer", runtime: "codex", cwd: "." },
      ],
      edges: [{ kind: "can_observe", from: "qa", to: "impl" }],
    },
  ],
  edges: [],
};

describe("RigSpec codec (pod-aware)", () => {
  it("serialize -> parse -> validate round-trips", () => {
    const yaml = RigSpecCodec.serialize(VALID_RIG);
    const parsed = RigSpecCodec.parse(yaml);
    const validation = RigSpecSchema.validate(parsed);
    expect(validation.valid).toBe(true);

    const normalized = RigSpecSchema.normalize(parsed as Record<string, unknown>);
    expect(normalized.name).toBe("dev-rig");
    expect(normalized.cultureFile).toBe("culture.md");
    expect(normalized.pods).toHaveLength(1);
    expect(normalized.pods[0]!.members).toHaveLength(2);
    expect(normalized.pods[0]!.edges).toHaveLength(1);
  });

  it("preserves pod/member/edge ordering", () => {
    const yaml = RigSpecCodec.serialize(VALID_RIG);
    const parsed = RigSpecCodec.parse(yaml) as Record<string, unknown>;
    const pods = parsed["pods"] as Array<Record<string, unknown>>;
    expect(pods[0]!["id"]).toBe("dev");
    const members = pods[0]!["members"] as Array<Record<string, unknown>>;
    expect(members[0]!["id"]).toBe("impl");
    expect(members[1]!["id"]).toBe("qa");
  });

  it("culture_file round-trips through serialize/parse", () => {
    const yaml = RigSpecCodec.serialize(VALID_RIG);
    expect(yaml).toContain("culture_file: culture.md");
    const parsed = RigSpecCodec.parse(yaml) as Record<string, unknown>;
    expect(parsed["culture_file"]).toBe("culture.md");
  });

  // R1: continuity_policy nested booleans round-trip through serialize -> parse -> normalize
  it("continuity_policy nested booleans round-trip correctly", () => {
    const rigWithCp: RigSpec = {
      version: "0.2",
      name: "cp-test",
      pods: [{
        id: "dev",
        label: "Dev",
        continuityPolicy: {
          enabled: true,
          syncTriggers: ["pre_compaction", "manual"],
          artifacts: { sessionLog: true, restoreBrief: false, quiz: true },
          restoreProtocol: { peerDriven: true, verifyViaQuiz: false },
        },
        members: [{ id: "impl", agentRef: "local:agents/impl", profile: "tdd", runtime: "claude-code", cwd: "." }],
        edges: [],
      }],
      edges: [],
    };

    const yaml = RigSpecCodec.serialize(rigWithCp);
    const parsed = RigSpecCodec.parse(yaml) as Record<string, unknown>;
    const normalized = RigSpecSchema.normalize(parsed);

    const cp = normalized.pods[0]!.continuityPolicy!;
    expect(cp.enabled).toBe(true);
    expect(cp.syncTriggers).toEqual(["pre_compaction", "manual"]);
    expect(cp.artifacts!.sessionLog).toBe(true);
    expect(cp.artifacts!.restoreBrief).toBe(false);
    expect(cp.artifacts!.quiz).toBe(true);
    expect(cp.restoreProtocol!.peerDriven).toBe(true);
    expect(cp.restoreProtocol!.verifyViaQuiz).toBe(false);
  });

  it("legacy codec still serializes/parses old flat specs", () => {
    const legacySpec = {
      schemaVersion: 1, name: "test", version: "1.0",
      nodes: [{ id: "impl", runtime: "claude-code" }],
      edges: [],
    };
    const yaml = LegacyRigSpecCodec.serialize(legacySpec);
    expect(yaml).toContain("schema_version: 1");
    const parsed = LegacyRigSpecCodec.parse(yaml) as Record<string, unknown>;
    expect(parsed["name"]).toBe("test");
  });
});
