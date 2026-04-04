import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SpecTopologyPreview } from "./SpecTopologyPreview.js";
import { WorkflowCodePreview } from "./WorkflowScaffold.js";
import type { RigSpecReview } from "../hooks/useSpecReview.js";

type Tab = "topology" | "configuration" | "yaml";

interface MemberInfo {
  id: string;
  agentRef: string;
  runtime: string;
  profile?: string;
}

interface RigSpecDisplayProps {
  review?: RigSpecReview | null;
  yaml: string;
  testIdPrefix?: string;
  yamlTestId?: string;
  onMemberClick?: (podId: string, member: MemberInfo) => void;
}

export function RigSpecDisplay({ review, yaml, testIdPrefix = "", yamlTestId, onMemberClick }: RigSpecDisplayProps) {
  const [activeTab, setActiveTab] = useState<Tab>("topology");
  const reviewPods = review?.pods ?? [];
  const reviewNodes = review?.nodes ?? [];
  const reviewEdges = review?.edges ?? [];
  const prefix = testIdPrefix ? `${testIdPrefix}-` : "";

  return (
    <>
      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-200">
        {(["topology", "configuration", "yaml"] as Tab[]).map((tab) => (
          <button
            key={tab}
            data-testid={`${prefix}tab-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
              activeTab === tab
                ? "border-b-2 border-stone-900 text-stone-900 font-bold"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "topology" && review && (
        <SpecTopologyPreview graph={review.graph} testId={`${prefix}topology-preview`} />
      )}

      {activeTab === "configuration" && review && (
        <div data-testid={`${prefix}config-tables`} className="space-y-4">
          {review.format === "pod_aware" && reviewPods.map((pod) => (
            <div key={pod.id} className="border border-stone-200 p-3">
              <div className="font-mono text-xs font-bold mb-2">{pod.label ?? pod.id}</div>
              <table className="w-full font-mono text-[10px]">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500">
                    <th className="text-left py-1">Member</th>
                    <th className="text-left py-1">Agent Ref</th>
                    <th className="text-left py-1">Runtime</th>
                    <th className="text-left py-1">Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {pod.members.map((m) => (
                    <tr key={m.id} className="border-b border-stone-100">
                      <td className="py-1">
                        <div className="flex items-center gap-2">
                          <span>{m.id}</span>
                          {onMemberClick && (
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid={`${prefix}member-open-agent-${pod.id}-${m.id}`}
                              className="h-6 px-2 font-mono text-[9px] uppercase tracking-[0.12em]"
                              onClick={() => onMemberClick(pod.id, m)}
                            >
                              Agent Spec
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="py-1 text-stone-600">{m.agentRef}</td>
                      <td className="py-1">{m.runtime}</td>
                      <td className="py-1 text-stone-500">{m.profile ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {review.format === "legacy" && reviewNodes.length > 0 && (
            <div className="border border-stone-200 p-3">
              <div className="font-mono text-xs font-bold mb-2">Nodes</div>
              <table className="w-full font-mono text-[10px]">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500">
                    <th className="text-left py-1">ID</th>
                    <th className="text-left py-1">Runtime</th>
                    <th className="text-left py-1">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewNodes.map((n) => (
                    <tr key={n.id} className="border-b border-stone-100">
                      <td className="py-1">{n.id}</td>
                      <td className="py-1">{n.runtime}</td>
                      <td className="py-1 text-stone-500">{n.role ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {reviewEdges.length > 0 && (
            <div className="border border-stone-200 p-3">
              <div className="font-mono text-xs font-bold mb-2">
                {review.format === "pod_aware" ? "Cross-Pod Edges" : "Edges"}
              </div>
              <table className="w-full font-mono text-[10px]">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500">
                    <th className="text-left py-1">From</th>
                    <th className="text-left py-1">To</th>
                    <th className="text-left py-1">Kind</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewEdges.map((e, i) => (
                    <tr key={i} className="border-b border-stone-100">
                      <td className="py-1">{e.from}</td>
                      <td className="py-1">{e.to}</td>
                      <td className="py-1 text-stone-500">{e.kind}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "yaml" && (
        <WorkflowCodePreview title="YAML Preview" testId={yamlTestId ?? `${prefix}spec-yaml`}>
          {yaml}
        </WorkflowCodePreview>
      )}
    </>
  );
}
