import { Handle, Position } from "@xyflow/react";

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

export function RigNode({ data }: { data: RigNodeData }) {
  return (
    <div style={{ padding: 12, border: "1px solid #ccc", borderRadius: 6, background: "#fff", minWidth: 160 }}>
      <Handle type="target" position={Position.Top} />
      <div style={{ fontWeight: "bold", marginBottom: 4 }}>{data.logicalId}</div>
      {data.role && <div style={{ fontSize: 12, color: "#666" }}>{data.role}</div>}
      {data.runtime && <div style={{ fontSize: 12 }}>{data.runtime}</div>}
      {data.status && <div style={{ fontSize: 12 }}>{data.status}</div>}
      {data.binding === null && <div style={{ fontSize: 11, color: "#999" }}>unbound</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
