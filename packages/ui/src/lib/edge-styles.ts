import type { CSSProperties } from "react";

export interface EdgeStyleResult {
  style: CSSProperties;
  animated: boolean;
  type: string;
}

/**
 * Maps edge kind to React Flow edge style — dark edges on light canvas.
 */
export function getEdgeStyle(kind: string): EdgeStyleResult {
  switch (kind) {
    case "delegates_to":
      return {
        style: { stroke: "#050505", strokeWidth: 2 },
        animated: false,
        type: "smoothstep",
      };
    case "spawned_by":
      return {
        style: { stroke: "#050505", strokeWidth: 2, strokeDasharray: "6 3" },
        animated: false,
        type: "smoothstep",
      };
    case "can_observe":
      return {
        style: { stroke: "#666666", strokeWidth: 1.5, strokeDasharray: "2 2" },
        animated: false,
        type: "smoothstep",
      };
    case "uses":
      return {
        style: { stroke: "#1272b8", strokeWidth: 1 },
        animated: false,
        type: "smoothstep",
      };
    default:
      return {
        style: { stroke: "#666666", strokeWidth: 1 },
        animated: false,
        type: "smoothstep",
      };
  }
}
