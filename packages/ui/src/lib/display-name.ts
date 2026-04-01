import { shortId } from "./display-id.js";

export function inferPodName(logicalId: string | null | undefined): string | null {
  if (!logicalId) return null;
  const parts = logicalId.split(".");
  if (parts.length <= 1) return logicalId;
  return parts[0] ?? logicalId;
}

export function displayPodName(podId: string | null | undefined): string {
  return podId && podId.length > 0 ? shortId(podId) : "ungrouped";
}

export function displayAgentName(logicalId: string | null | undefined): string {
  if (!logicalId) return "unknown";
  const parts = logicalId.split(".");
  if (parts.length <= 1) return logicalId;
  return parts.at(-1) ?? logicalId;
}
