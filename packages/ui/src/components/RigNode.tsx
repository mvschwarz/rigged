import { useRef, useEffect, useState } from "react";
import { Handle, Position } from "@xyflow/react";

interface RigNodeData {
  logicalId: string;
  rigId?: string;
  role: string | null;
  runtime: string | null;
  model: string | null;
  status: string | null;
  packageRefs?: string[];
  nodeKind?: "agent" | "infrastructure";
  startupStatus?: "pending" | "ready" | "failed" | null;
  canonicalSessionName?: string | null;
  podId?: string | null;
  restoreOutcome?: string;
  resumeToken?: string | null;
  binding: {
    tmuxSession?: string | null;
    cmuxSurface?: string | null;
  } | null;
}

/** Core roles get dark header stripe, workers get light */
function isCore(role: string | null): boolean {
  return role === "architect" || role === "lead" || role === "orchestrator";
}

function getStartupStatusLabel(startupStatus: string | null | undefined): string {
  switch (startupStatus) {
    case "ready": return "READY";
    case "pending": return "LAUNCHING";
    case "failed": return "FAILED";
    default: return "STOPPED";
  }
}

function getStartupStatusColor(startupStatus: string | null | undefined): string {
  switch (startupStatus) {
    case "ready": return "#22c55e"; // green-500
    case "pending": return "#f59e0b"; // amber-500
    case "failed": return "#ef4444"; // red-500
    default: return "#a8a29e"; // stone-400
  }
}

function getStartupStatusBorder(startupStatus: string | null | undefined): string {
  switch (startupStatus) {
    case "ready": return "border-green-500";
    case "pending": return "border-amber-500";
    case "failed": return "border-red-500";
    default: return "border-stone-400";
  }
}

export function RigNode({ data }: { data: RigNodeData }) {
  const prevStatusRef = useRef(data.startupStatus);
  const [statusChanged, setStatusChanged] = useState(false);
  const [showToolbar, setShowToolbar] = useState(false);
  const core = isCore(data.role);
  const isInfra = data.nodeKind === "infrastructure";

  useEffect(() => {
    if (prevStatusRef.current !== data.startupStatus && prevStatusRef.current !== null) {
      setStatusChanged(true);
      const timer = setTimeout(() => setStatusChanged(false), 600);
      prevStatusRef.current = data.startupStatus;
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = data.startupStatus;
  }, [data.startupStatus]);

  const runtimeModel = [data.runtime, data.model].filter(Boolean).join(" \u00B7 ");
  const statusColor = getStartupStatusColor(data.startupStatus);

  const handleCopyAttach = (e: React.MouseEvent) => {
    e.stopPropagation();
    const name = data.canonicalSessionName ?? data.binding?.tmuxSession;
    if (name) navigator.clipboard?.writeText(`tmux attach -t ${name}`);
  };

  const handleFocusCmux = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.binding?.cmuxSurface || !data.rigId) return;
    try {
      await fetch(`/api/rigs/${encodeURIComponent(data.rigId)}/nodes/${encodeURIComponent(data.logicalId)}/focus`, { method: "POST" });
    } catch { /* best-effort */ }
  };

  const handleCopyResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!data.resumeToken) return;
    if (data.runtime === "claude-code") {
      navigator.clipboard?.writeText(`claude --resume ${data.resumeToken}`);
    } else if (data.runtime === "codex") {
      navigator.clipboard?.writeText(`codex resume ${data.resumeToken}`);
    }
  };

  return (
    <div
      className="bg-white border border-stone-900 min-w-[200px] hard-shadow relative"
      data-testid="rig-node"
      onMouseEnter={() => setShowToolbar(true)}
      onMouseLeave={() => setShowToolbar(false)}
    >
      <Handle type="target" position={Position.Top} />

      {/* Header stripe — dark for core, muted for infra, light for workers */}
      <div className={`px-3 py-1 font-mono text-[10px] flex justify-between items-center ${
        isInfra
          ? "bg-stone-400 text-stone-900 border-b border-stone-900"
          : core
            ? "bg-stone-900 text-white"
            : "bg-stone-200 text-stone-900 border-b border-stone-900"
      }`}>
        <span>
          {isInfra ? "INFRA" : (data.role ?? "AGENT").toUpperCase()}
          {data.podId && <span className="ml-2 opacity-60">{data.podId}</span>}
        </span>
        <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 0, 'wght' 300" }}>
          {core ? "settings" : "link"}
        </span>
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        {/* Name + status badge */}
        <div className="flex justify-between items-end border-b border-stone-100 pb-2">
          <span className="font-headline font-bold text-sm tracking-tight uppercase">
            {data.logicalId}
          </span>
          <span
            className={`px-2 py-0.5 border font-mono text-[8px] uppercase ${getStartupStatusBorder(data.startupStatus)} ${statusChanged ? "status-changed" : ""}`}
            style={{ "--status-color": statusColor, color: statusColor } as React.CSSProperties}
            data-testid={`status-dot-${data.logicalId}`}
          >
            {getStartupStatusLabel(data.startupStatus)}
          </span>
        </div>

        {/* Runtime info */}
        {runtimeModel && (
          <div className="flex justify-between font-mono text-[9px] text-secondary">
            <span>RUNTIME</span>
            <span>{runtimeModel}</span>
          </div>
        )}

        {/* Restore outcome */}
        {data.restoreOutcome && data.restoreOutcome !== "n-a" && (
          <div className="font-mono text-[8px] text-stone-500">
            RESTORE: {data.restoreOutcome}
          </div>
        )}

        {/* Package badge (legacy) */}
        {data.packageRefs && data.packageRefs.length > 0 && (
          <div
            data-testid="package-badge"
            title={data.packageRefs.join(", ")}
            className="font-mono text-[8px] text-stone-400"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            PKG {data.packageRefs.length}
          </div>
        )}

        {/* Alert state for failed */}
        {data.startupStatus === "failed" && (
          <div className="stamp-badge">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-red-600">FAILED</span>
          </div>
        )}
      </div>

      {/* Node toolbar — appears on hover */}
      {showToolbar && (
        <div
          data-testid="node-toolbar"
          className="absolute -bottom-8 left-0 right-0 flex gap-1 justify-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleCopyAttach}
            data-testid="toolbar-copy-attach"
            className="px-1.5 py-0.5 bg-white border border-stone-300 font-mono text-[7px] hover:bg-stone-100 uppercase"
            title={`tmux attach -t ${data.canonicalSessionName ?? data.binding?.tmuxSession ?? "?"}`}
          >
            tmux
          </button>
          {data.binding?.cmuxSurface && (
            <button
              onClick={handleFocusCmux}
              data-testid="toolbar-cmux-focus"
              className="px-1.5 py-0.5 bg-white border border-stone-300 font-mono text-[7px] hover:bg-stone-100 uppercase"
            >
              cmux
            </button>
          )}
          {data.resumeToken && data.runtime && data.runtime !== "terminal" && (
            <button
              onClick={handleCopyResume}
              data-testid="toolbar-copy-resume"
              className="px-1.5 py-0.5 bg-white border border-stone-300 font-mono text-[7px] hover:bg-stone-100 uppercase"
            >
              resume
            </button>
          )}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
