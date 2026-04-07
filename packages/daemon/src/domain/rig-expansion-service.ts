import type Database from "better-sqlite3";
import type { RigRepository } from "./rig-repository.js";
import type { EventBus } from "./event-bus.js";
import type { NodeLauncher } from "./node-launcher.js";
import type { PodRigInstantiator } from "./rigspec-instantiator.js";
import type { SessionRegistry } from "./session-registry.js";
import type { ExpansionRequest, ExpansionResult, ExpansionNodeOutcome } from "./types.js";

interface RigExpansionServiceDeps {
  db: Database.Database;
  rigRepo: RigRepository;
  eventBus: EventBus;
  nodeLauncher: NodeLauncher;
  podInstantiator: PodRigInstantiator;
  sessionRegistry: SessionRegistry;
}

/**
 * Orchestrates live rig expansion by composing PodRigInstantiator.materialize()
 * for topology persistence and NodeLauncher for launching new nodes.
 */
export class RigExpansionService {
  private deps: RigExpansionServiceDeps;

  constructor(deps: RigExpansionServiceDeps) {
    this.deps = deps;
  }

  async expand(request: ExpansionRequest): Promise<ExpansionResult> {
    // 1. Validate rig exists
    const rig = this.deps.rigRepo.getRig(request.rigId);
    if (!rig) {
      return { ok: false, code: "rig_not_found", error: `Rig "${request.rigId}" not found` };
    }

    // 2. Build synthetic rig spec YAML for the new pod
    const pod = request.pod;
    const syntheticSpec = this.buildSyntheticSpec(rig.rig.name, pod, request.crossPodEdges);

    // 3. Materialize topology (suppress rig.imported event)
    const materializeResult = await this.deps.podInstantiator.materialize(
      syntheticSpec,
      request.rigRoot ?? ".",
      { targetRigId: request.rigId, suppressSummaryEvent: true },
    );

    if (!materializeResult.ok) {
      const code = materializeResult.code;
      const message = "message" in materializeResult
        ? materializeResult.message
        : "errors" in materializeResult
          ? materializeResult.errors.join("; ")
          : "materialization failed";
      return { ok: false, code, error: message };
    }

    // 4. Find the newly created pod and nodes
    const updatedRig = this.deps.rigRepo.getRig(request.rigId)!;
    const newNodes = materializeResult.result.nodes;
    const newPod = updatedRig.nodes
      .filter((n) => newNodes.some((nn) => nn.logicalId === n.logicalId))
      .map((n) => n.podId)
      .find((id) => id !== null);

    const podId = newPod ?? "";
    const podNamespace = pod.id;

    // 5. Launch and fully start the newly created nodes via the pod-aware seam
    const launchOutcome = await this.deps.podInstantiator.launchMaterialized(
      syntheticSpec,
      request.rigRoot ?? ".",
      request.rigId,
    );
    if (!launchOutcome.ok) {
      const message = "message" in launchOutcome
        ? launchOutcome.message
        : "errors" in launchOutcome
          ? launchOutcome.errors.join("; ")
          : "launch failed";
      return { ok: false, code: launchOutcome.code, error: message };
    }

    const nodeOutcomes: ExpansionNodeOutcome[] = launchOutcome.result.nodes.map((node) => ({
      logicalId: node.logicalId,
      nodeId: node.nodeId,
      status: node.status,
      error: node.error,
      sessionName: node.sessionName,
    }));
    const warnings = launchOutcome.result.warnings ?? [];
    const retryTargets = nodeOutcomes
      .filter((node) => node.status === "failed")
      .map((node) => node.logicalId);

    // 6. Determine overall status
    const launched = nodeOutcomes.filter((n) => n.status === "launched").length;
    const failed = nodeOutcomes.filter((n) => n.status === "failed").length;
    const status: "ok" | "partial" | "failed" = failed === 0 ? "ok" : launched > 0 ? "partial" : "failed";

    // 7. Emit rig.expanded event
    this.deps.eventBus.emit({
      type: "rig.expanded",
      rigId: request.rigId,
      podId,
      podNamespace,
      nodes: nodeOutcomes,
      status,
    });

    return {
      ok: true,
      status,
      podId,
      podNamespace,
      nodes: nodeOutcomes,
      warnings,
      retryTargets,
    };
  }

  private buildSyntheticSpec(
    rigName: string,
    pod: ExpansionRequest["pod"],
    crossPodEdges?: ExpansionRequest["crossPodEdges"],
  ): string {
    const members = pod.members.map((m) => {
      const lines = [`      - id: ${m.id}`, `        runtime: ${m.runtime}`];
      if (m.agentRef) lines.push(`        agent_ref: "${m.agentRef}"`);
      if (m.profile) lines.push(`        profile: ${m.profile}`);
      if (m.cwd) lines.push(`        cwd: "${m.cwd}"`);
      if (m.model) lines.push(`        model: ${m.model}`);
      if (m.restorePolicy) lines.push(`        restore_policy: ${m.restorePolicy}`);
      if (m.label) lines.push(`        label: "${m.label}"`);
      return lines.join("\n");
    });

    const podEdges = pod.edges.map((e) =>
      `      - kind: ${e.kind}\n        from: ${e.from}\n        to: ${e.to}`
    );

    const crossEdges = (crossPodEdges ?? []).map((e) =>
      `  - kind: ${e.kind}\n    from: ${e.from}\n    to: ${e.to}`
    );

    return [
      `version: "0.2"`,
      `name: ${rigName}`,
      `pods:`,
      `  - id: ${pod.id}`,
      `    label: "${pod.label}"`,
      pod.summary ? `    summary: "${pod.summary}"` : null,
      `    members:`,
      ...members,
      `    edges:`,
      podEdges.length > 0 ? podEdges.join("\n") : `      []`,
      crossEdges.length > 0 ? `edges:\n${crossEdges.join("\n")}` : `edges: []`,
    ].filter((line): line is string => line !== null).join("\n");
  }
}
