import { useMemo } from "react";
import { ReactFlow, MiniMap, Controls, type NodeTypes, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRigGraph } from "../hooks/useRigGraph.js";
import { RigNode } from "./RigNode.js";

const nodeTypes: NodeTypes = {
  rigNode: RigNode,
};

export function RigGraph({ rigId }: { rigId: string | null }) {
  const { nodes, edges, loading, error } = useRigGraph(rigId);

  const rfNodes = useMemo(() => nodes as Node[], [nodes]);
  const rfEdges = useMemo(() => edges as Edge[], [edges]);

  if (rigId === null) {
    return <div>No rig selected</div>;
  }

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  if (rfNodes.length === 0) {
    return <div>No nodes in this rig</div>;
  }

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        fitView
      >
        <MiniMap />
        <Controls />
      </ReactFlow>
    </div>
  );
}
