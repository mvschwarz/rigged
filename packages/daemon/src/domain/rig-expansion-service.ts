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

    // 5. Launch each newly created node
    const nodeOutcomes: ExpansionNodeOutcome[] = [];
    const warnings: string[] = [];
    const retryTargets: string[] = [];

    for (const materialized of newNodes) {
      const node = updatedRig.nodes.find((n) => n.logicalId === materialized.logicalId);
      if (!node) {
        nodeOutcomes.push({
          logicalId: materialized.logicalId,
          nodeId: "",
          status: "failed",
          error: "Node not found after materialization",
        });
        retryTargets.push(materialized.logicalId);
        continue;
      }

      try {
        const launchResult = await this.deps.nodeLauncher.launchNode(request.rigId, node.logicalId);
        if (launchResult.ok) {
          nodeOutcomes.push({
            logicalId: materialized.logicalId,
            nodeId: node.id,
            status: "launched",
            sessionName: launchResult.sessionName,
          });
        } else {
          nodeOutcomes.push({
            logicalId: materialized.logicalId,
            nodeId: node.id,
            status: "failed",
            error: launchResult.message ?? "launch failed",
          });
          retryTargets.push(materialized.logicalId);
        }
      } catch (err) {
        nodeOutcomes.push({
          logicalId: materialized.logicalId,
          nodeId: node.id,
          status: "failed",
          error: (err as Error).message,
        });
        retryTargets.push(materialized.logicalId);
      }
    }

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
