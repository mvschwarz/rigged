import type Database from "better-sqlite3";
import type { RigRepository } from "./rig-repository.js";
import type { PodRepository } from "./pod-repository.js";
import type { SessionRegistry } from "./session-registry.js";
import type { EventBus } from "./event-bus.js";
import type { PersistedEvent } from "./types.js";
import type { TmuxAdapter } from "../adapters/tmux.js";
import type { TranscriptStore } from "./transcript-store.js";
import { startTmuxTranscriptCapture } from "./transcript-capture.js";

export type SelfAttachSuccess = {
  ok: true;
  nodeId: string;
  logicalId: string;
  sessionId: string;
  sessionName: string;
  attachmentType: "tmux" | "external_cli";
  env: {
    OPENRIG_NODE_ID: string;
    OPENRIG_SESSION_NAME: string;
  };
};

export type SelfAttachFailureCode =
  | "rig_not_found"
  | "node_not_found"
  | "pod_not_found"
  | "already_bound"
  | "duplicate_logical_id"
  | "invalid_member_name"
  | "runtime_required"
  | "runtime_mismatch";

export type SelfAttachResult =
  | SelfAttachSuccess
  | { ok: false; code: SelfAttachFailureCode; error: string };

interface SelfAttachServiceDeps {
  db: Database.Database;
  rigRepo: RigRepository;
  podRepo: PodRepository;
  sessionRegistry: SessionRegistry;
  eventBus: EventBus;
  tmuxAdapter?: TmuxAdapter;
  transcriptStore?: TranscriptStore;
}

interface AttachToNodeOptions {
  rigId: string;
  logicalId: string;
  runtime?: string;
  cwd?: string;
  displayName?: string;
  context?: SelfAttachContext;
}

interface AttachToPodOptions {
  rigId: string;
  podNamespace: string;
  memberName: string;
  runtime: string;
  cwd?: string;
  displayName?: string;
  context?: SelfAttachContext;
}

interface ExternalCliAttachContext {
  attachmentType: "external_cli";
  sessionName?: string;
}

interface TmuxAttachContext {
  attachmentType: "tmux";
  tmuxSession: string;
  tmuxWindow?: string;
  tmuxPane?: string;
}

export type SelfAttachContext = ExternalCliAttachContext | TmuxAttachContext;

export class SelfAttachService {
  readonly db: Database.Database;
  private rigRepo: RigRepository;
  private podRepo: PodRepository;
  private sessionRegistry: SessionRegistry;
  private eventBus: EventBus;
  private tmuxAdapter: TmuxAdapter | null;
  private transcriptStore: TranscriptStore | null;

  constructor(deps: SelfAttachServiceDeps) {
    if (deps.db !== deps.rigRepo.db) throw new Error("SelfAttachService: rigRepo must share the same db handle");
    if (deps.db !== deps.podRepo.db) throw new Error("SelfAttachService: podRepo must share the same db handle");
    if (deps.db !== deps.sessionRegistry.db) throw new Error("SelfAttachService: sessionRegistry must share the same db handle");
    if (deps.db !== deps.eventBus.db) throw new Error("SelfAttachService: eventBus must share the same db handle");
    this.db = deps.db;
    this.rigRepo = deps.rigRepo;
    this.podRepo = deps.podRepo;
    this.sessionRegistry = deps.sessionRegistry;
    this.eventBus = deps.eventBus;
    this.tmuxAdapter = deps.tmuxAdapter ?? null;
    this.transcriptStore = deps.transcriptStore ?? null;
  }

  async attachToNode(opts: AttachToNodeOptions): Promise<SelfAttachResult> {
    const rig = this.rigRepo.getRig(opts.rigId);
    if (!rig) {
      return { ok: false, code: "rig_not_found", error: "Target rig not found" };
    }

    const node = rig.nodes.find((candidate) => candidate.logicalId === opts.logicalId);
    if (!node) {
      return { ok: false, code: "node_not_found", error: `Logical ID '${opts.logicalId}' does not exist in rig` };
    }

    const existingBinding = this.sessionRegistry.getBindingForNode(node.id);
    if (existingBinding) {
      return { ok: false, code: "already_bound", error: `Logical ID '${opts.logicalId}' is already bound` };
    }

    if (opts.runtime && node.runtime && opts.runtime !== node.runtime) {
      return {
        ok: false,
        code: "runtime_mismatch",
        error: `Logical ID '${opts.logicalId}' expects runtime '${node.runtime}', but attach-self declared '${opts.runtime}'`,
      };
    }

    return this.attachExistingNode({
      rigId: opts.rigId,
      rigName: rig.rig.name,
      nodeId: node.id,
      logicalId: node.logicalId,
      context: this.resolveContext(node.logicalId, rig.rig.name, opts.displayName, opts.context),
    });
  }

  async attachToPod(opts: AttachToPodOptions): Promise<SelfAttachResult> {
    const rig = this.rigRepo.getRig(opts.rigId);
    if (!rig) {
      return { ok: false, code: "rig_not_found", error: "Target rig not found" };
    }

    const pod = this.podRepo.getPodByNamespace(opts.rigId, opts.podNamespace);
    if (!pod) {
      return { ok: false, code: "pod_not_found", error: `Pod namespace '${opts.podNamespace}' not found in rig` };
    }

    const memberName = opts.memberName.trim();
    if (!memberName) {
      return { ok: false, code: "invalid_member_name", error: "memberName is required" };
    }

    const runtime = opts.runtime.trim();
    if (!runtime) {
      return { ok: false, code: "runtime_required", error: "runtime is required when creating a new pod member" };
    }

    const logicalId = `${pod.namespace}.${memberName}`;
    if (rig.nodes.some((candidate) => candidate.logicalId === logicalId)) {
      return { ok: false, code: "duplicate_logical_id", error: `Logical ID '${logicalId}' already exists in rig` };
    }

    const attachTx = this.db.transaction(() => {
      const node = this.rigRepo.addNode(opts.rigId, logicalId, {
        runtime,
        cwd: opts.cwd,
        podId: pod.id,
      });
      const attached = this.attachExistingNodeWithinTransaction({
        rigId: opts.rigId,
        nodeId: node.id,
        logicalId,
        context: this.resolveContext(logicalId, rig.rig.name, opts.displayName, opts.context),
      });
      return attached;
    });

    try {
      const result = attachTx();
      await this.maybeStartTranscriptCapture(rig.rig.name, result.sessionName, result.attachmentType);
      this.eventBus.notifySubscribers(result.event);
      return this.toSuccess(result.nodeId, result.logicalId, result.sessionId, result.sessionName, result.attachmentType);
    } catch (error) {
      return { ok: false, code: "duplicate_logical_id", error: (error as Error).message };
    }
  }

  private async attachExistingNode(args: {
    rigId: string;
    rigName: string;
    nodeId: string;
    logicalId: string;
    context: SelfAttachContext;
  }): Promise<SelfAttachResult> {
    const attachTx = this.db.transaction(() =>
      this.attachExistingNodeWithinTransaction({
        rigId: args.rigId,
        nodeId: args.nodeId,
        logicalId: args.logicalId,
        context: args.context,
      })
    );

    try {
      const result = attachTx();
      return this.finalizeAttach(args.rigName, result);
    } catch (error) {
      return { ok: false, code: "already_bound", error: (error as Error).message };
    }
  }

  private async finalizeAttach(
    rigName: string,
    result: {
      nodeId: string;
      logicalId: string;
      sessionId: string;
      sessionName: string;
      attachmentType: "tmux" | "external_cli";
      event: PersistedEvent;
    },
  ): Promise<SelfAttachResult> {
    try {
      await this.maybeStartTranscriptCapture(rigName, result.sessionName, result.attachmentType);
      this.eventBus.notifySubscribers(result.event);
      return this.toSuccess(result.nodeId, result.logicalId, result.sessionId, result.sessionName, result.attachmentType);
    } catch (error) {
      return { ok: false, code: "already_bound", error: (error as Error).message };
    }
  }

  private attachExistingNodeWithinTransaction(args: {
    rigId: string;
    nodeId: string;
    logicalId: string;
    context: SelfAttachContext;
  }): {
    nodeId: string;
    logicalId: string;
    sessionId: string;
    sessionName: string;
    attachmentType: "tmux" | "external_cli";
    event: PersistedEvent;
  } {
    const sessionName = args.context.attachmentType === "tmux"
      ? args.context.tmuxSession
      : args.context.sessionName ?? `unknown-${args.nodeId.slice(-6)}`;

    this.sessionRegistry.updateBinding(args.nodeId, args.context.attachmentType === "tmux"
      ? {
          attachmentType: "tmux",
          tmuxSession: args.context.tmuxSession,
          tmuxWindow: args.context.tmuxWindow,
          tmuxPane: args.context.tmuxPane,
        }
      : {
          attachmentType: "external_cli",
          externalSessionName: sessionName,
        });
    const session = this.sessionRegistry.registerClaimedSession(args.nodeId, sessionName);
    const event = this.eventBus.persistWithinTransaction({
      type: "binding.updated",
      rigId: args.rigId,
      nodeId: args.nodeId,
    });

    return {
      nodeId: args.nodeId,
      logicalId: args.logicalId,
      sessionId: session.id,
      sessionName,
      attachmentType: args.context.attachmentType,
      event,
    };
  }

  private resolveContext(
    logicalId: string,
    rigName: string,
    displayName?: string,
    context?: SelfAttachContext,
  ): SelfAttachContext {
    if (context?.attachmentType === "tmux") {
      return context;
    }
    const explicit = context?.attachmentType === "external_cli" ? context.sessionName?.trim() : displayName?.trim();
    return {
      attachmentType: "external_cli",
      sessionName: explicit || `${logicalId.replace(/\./g, "-")}@${rigName}`,
    };
  }

  private async maybeStartTranscriptCapture(
    rigName: string,
    sessionName: string,
    attachmentType: "tmux" | "external_cli",
  ): Promise<void> {
    if (attachmentType !== "tmux") return;
    await startTmuxTranscriptCapture(this.tmuxAdapter, this.transcriptStore, rigName, sessionName);
  }

  private toSuccess(
    nodeId: string,
    logicalId: string,
    sessionId: string,
    sessionName: string,
    attachmentType: "tmux" | "external_cli",
  ): SelfAttachSuccess {
    return {
      ok: true,
      nodeId,
      logicalId,
      sessionId,
      sessionName,
      attachmentType,
      env: {
        OPENRIG_NODE_ID: nodeId,
        OPENRIG_SESSION_NAME: sessionName,
      },
    };
  }
}
