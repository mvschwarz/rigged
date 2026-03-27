import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

const MAX_EVENTS = 30;
const TICK_INTERVAL_MS = 15_000;

export interface ActivityEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  receivedAt: number; // Date.now() when received
}

export interface UseActivityFeedResult {
  events: ActivityEvent[];
  connected: boolean;
  feedOpen: boolean;
  setFeedOpen: (open: boolean) => void;
}

export function useActivityFeed(): UseActivityFeedResult {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const hasErroredRef = useRef(false);
  // Force re-render for relative timestamps
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const addEvent = useCallback((data: string) => {
    try {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      const event: ActivityEvent = {
        seq: typeof parsed["seq"] === "number" ? parsed["seq"] : Date.now(),
        type: (parsed["type"] as string) ?? "unknown",
        payload: parsed,
        createdAt: (parsed["createdAt"] as string) ?? new Date().toISOString(),
        receivedAt: Date.now(),
      };
      setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));

      // Invalidate package queries on package mutation events
      if (event.type === "package.installed" || event.type === "package.rolledback") {
        queryClient.invalidateQueries({ queryKey: ["packages"] });
      }
      // Invalidate rig summary on bootstrap completion (new rig may have been created)
      if (event.type === "bootstrap.completed" || event.type === "bootstrap.partial") {
        queryClient.invalidateQueries({ queryKey: ["rigs", "summary"] });
      }
      // Invalidate discovery queries on discovery events
      if (event.type === "session.discovered" || event.type === "session.vanished") {
        queryClient.invalidateQueries({ queryKey: ["discovery"] });
      }
      // node.claimed: invalidate discovery + target rig graph
      if (event.type === "node.claimed") {
        queryClient.invalidateQueries({ queryKey: ["discovery"] });
        const rigId = event.payload["rigId"] as string | undefined;
        if (rigId) queryClient.invalidateQueries({ queryKey: ["rig", rigId, "graph"] });
      }
    } catch {
      // Ignore unparseable messages
    }
  }, [queryClient]);

  useEffect(() => {
    hasErroredRef.current = false;
    setConnected(false);

    const es = new EventSource("/api/events");

    es.addEventListener("open", () => {
      setConnected(true);
      hasErroredRef.current = false;
    });

    es.addEventListener("message", (event: Event) => {
      const msgEvent = event as MessageEvent;
      addEvent(msgEvent.data as string);
    });

    es.addEventListener("error", () => {
      setConnected(false);
      hasErroredRef.current = true;
    });

    return () => {
      es.close();
    };
  }, [addEvent]);

  return { events, connected, feedOpen, setFeedOpen };
}

export function formatRelativeTime(receivedAt: number, now?: number): string {
  const elapsed = ((now ?? Date.now()) - receivedAt) / 1000;
  if (elapsed < 10) return "just now";
  if (elapsed < 60) return `${Math.floor(elapsed)}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return new Date(receivedAt).toLocaleDateString();
}

/** Maps event type to a CSS color class for the status dot */
export function eventColor(type: string): string {
  if (type.startsWith("bootstrap.")) return "bg-accent";
  if (type.startsWith("package.")) return "bg-primary";
  if (type.startsWith("rig.")) return "bg-accent";
  if (type.startsWith("snapshot.")) return "bg-primary";
  if (type.startsWith("restore.")) return "bg-warning";
  if (type === "session.detached") return "bg-destructive";
  if (type === "session.discovered") return "bg-accent";
  if (type === "session.vanished") return "bg-destructive";
  if (type === "node.claimed") return "bg-primary";
  if (type === "node.launched") return "bg-primary";
  return "bg-foreground-muted-on-dark";
}

/** Maps event to a one-line summary string */
export function eventSummary(event: ActivityEvent): string {
  const p = event.payload;
  switch (event.type) {
    case "bootstrap.planned":
      return `bootstrap planned: ${p["sourceRef"]}`;
    case "bootstrap.started":
      return `bootstrap started: ${p["sourceRef"]}`;
    case "bootstrap.completed":
      return `bootstrap completed \u2192 rig ${p["rigId"]}`;
    case "bootstrap.partial":
      return `bootstrap partial: ${p["completed"]} ok, ${p["failed"]} failed`;
    case "bootstrap.failed":
      return `bootstrap failed: ${p["error"]}`;
    case "package.validated":
      return `${p["packageName"]} validated`;
    case "package.planned":
      return `${p["packageName"]} planned: ${p["actionable"]} actionable, ${p["deferred"]} deferred`;
    case "package.installed":
      return `${p["packageName"]} v${p["packageVersion"]} \u2192 ${p["applied"]} applied, ${p["deferred"]} deferred`;
    case "package.rolledback":
      return `Install ${p["installId"]} \u2192 ${p["restored"]} files restored`;
    case "package.install_failed":
      return `${p["packageName"]} failed: ${p["message"]}`;
    case "rig.created":
      return `${p["rigId"]} \u2192 rig created`;
    case "rig.deleted":
      return `${p["rigId"]} \u2192 rig deleted`;
    case "rig.imported":
      return `${p["specName"]} \u2192 rig created`;
    case "snapshot.created":
      return `${p["rigId"]} \u2192 ${p["kind"]} snapshot`;
    case "restore.started":
      return `${p["rigId"]} \u2192 restore started`;
    case "restore.completed": {
      const nodes = Array.isArray(p["result"]) ? p["result"] : ((p["result"] as Record<string, unknown>)?.["nodes"] as unknown[]) ?? [];
      return `${p["rigId"]} \u2192 ${nodes.length} nodes restored`;
    }
    case "node.launched":
      return `${String(p["logicalId"] ?? p["nodeId"] ?? "unknown")} \u2192 launched in ${p["sessionName"]}`;
    case "session.detached":
      return `${p["sessionName"]} \u2192 session lost`;
    case "session.discovered":
      return `${p["tmuxSession"]}:${p["tmuxPane"]} \u2192 discovered (${p["runtimeHint"]})`;
    case "session.vanished":
      return `${p["tmuxSession"]}:${p["tmuxPane"]} \u2192 vanished`;
    case "node.claimed":
      return `${p["logicalId"]} \u2192 claimed into rig`;
    default:
      return event.type;
  }
}

/** Returns a route path for navigable events, or null for non-navigable ones */
export function eventRoute(event: ActivityEvent): string | null {
  const p = event.payload;
  const rigId = p["rigId"] as string | undefined;

  // Discovery events
  if (event.type === "session.discovered" || event.type === "session.vanished") return "/discovery";
  if (event.type === "node.claimed") {
    const claimRigId = event.payload["rigId"] as string | undefined;
    return claimRigId ? `/rigs/${claimRigId}` : "/discovery";
  }

  // Bootstrap events navigate to /bootstrap
  if (event.type.startsWith("bootstrap.")) return "/bootstrap";

  // Package events navigate to /packages
  if (event.type.startsWith("package.")) return "/packages";

  // Rig-scoped events
  if (rigId) {
    return `/rigs/${rigId}`;
  }

  return null;
}
