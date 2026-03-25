import { useRef, useEffect, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { getStatusColorClass } from "@/lib/status-colors";

interface RigNodeData {
  logicalId: string;
  role: string | null;
  runtime: string | null;
  model: string | null;
  status: string | null;
  binding: {
    tmuxSession?: string | null;
    cmuxSurface?: string | null;
  } | null;
}

function getStatusCssColor(status: string | null): string {
  switch (status) {
    case "running": return "hsl(var(--primary))";
    case "idle": return "hsl(var(--foreground-muted))";
    case "exited": return "hsl(var(--destructive))";
    case "detached": return "hsl(var(--warning))";
    default: return "hsl(var(--foreground-muted))";
  }
}

export function RigNode({ data }: { data: RigNodeData }) {
  const statusColor = getStatusColorClass(data.status);
  const statusCssColor = getStatusCssColor(data.status);
  const prevStatusRef = useRef(data.status);
  const [statusChanged, setStatusChanged] = useState(false);

  useEffect(() => {
    if (prevStatusRef.current !== data.status && prevStatusRef.current !== null) {
      setStatusChanged(true);
      const timer = setTimeout(() => setStatusChanged(false), 600);
      prevStatusRef.current = data.status;
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = data.status;
  }, [data.status]);
  const runtimeModel = [data.runtime, data.model].filter(Boolean).join(" · ");
  const sessionName = data.binding?.tmuxSession;

  return (
    <div className="bg-surface-low p-spacing-3 min-w-[200px]" data-testid="rig-node">
      <Handle type="target" position={Position.Top} />

      {/* Header: status dot + uppercase label */}
      <div className="flex items-center gap-spacing-2 mb-spacing-1">
        <span
          data-testid={`status-dot-${data.logicalId}`}
          className={`inline-block w-2 h-2 ${statusColor} ${statusChanged ? "status-changed" : ""}`}
          style={{ "--status-color": statusCssColor } as React.CSSProperties}
        />
        <span className="text-label-md uppercase tracking-[0.04em] text-foreground">
          {data.logicalId}
        </span>
      </div>

      {/* Runtime + model */}
      {runtimeModel && (
        <div className="text-label-sm text-foreground-muted mb-spacing-1">
          {runtimeModel}
        </div>
      )}

      {/* Session name (mono) */}
      {sessionName && (
        <div className="text-label-sm font-mono text-foreground-muted mb-spacing-2">
          {sessionName}
        </div>
      )}

      {/* Recessed telemetry block */}
      <div className="bg-surface p-spacing-2">
        <div className="flex items-center gap-spacing-2 text-label-sm">
          <span className="text-foreground-muted uppercase">STATUS</span>
          <span className={`font-mono ${data.status === "running" ? "text-primary" : data.status === "exited" ? "text-destructive" : data.status === "detached" ? "text-warning" : "text-foreground-muted"}`}>
            {data.status ?? "unknown"}
          </span>
        </div>
        <div className="flex items-center gap-spacing-2 text-label-sm mt-spacing-1">
          <span className="text-foreground-muted uppercase">BOUND</span>
          <span className="font-mono text-foreground-muted">
            {data.binding ? `tmux:${data.binding.tmuxSession ?? "—"}` : "unbound"}
          </span>
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
