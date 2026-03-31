import { useQuery } from "@tanstack/react-query";

export interface NodeDetailData {
  rigId: string;
  rigName: string;
  logicalId: string;
  podId: string | null;
  canonicalSessionName: string | null;
  nodeKind: "agent" | "infrastructure";
  runtime: string | null;
  sessionStatus: string | null;
  startupStatus: "pending" | "ready" | "failed" | null;
  restoreOutcome: string;
  tmuxAttachCommand: string | null;
  resumeCommand: string | null;
  latestError: string | null;
  model: string | null;
  agentRef: string | null;
  profile: string | null;
  resolvedSpecName: string | null;
  resolvedSpecVersion: string | null;
  startupFiles: Array<{ path: string; deliveryHint: string; required: boolean }>;
  startupActions: Array<{ type: string; value: string }>;
  recentEvents: Array<{ type: string; createdAt: string }>;
  infrastructureStartupCommand: string | null;
}

async function fetchNodeDetail(rigId: string, logicalId: string): Promise<NodeDetailData> {
  const res = await fetch(`/api/rigs/${encodeURIComponent(rigId)}/nodes/${encodeURIComponent(logicalId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function useNodeDetail(rigId: string | null, logicalId: string | null) {
  return useQuery({
    queryKey: ["rig", rigId, "nodes", logicalId],
    queryFn: () => fetchNodeDetail(rigId!, logicalId!),
    enabled: !!rigId && !!logicalId,
  });
}
