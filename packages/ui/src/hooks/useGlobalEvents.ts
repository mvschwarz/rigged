import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Global SSE event listener. Connects to /api/events (all events)
 * and invalidates relevant queries when state-changing events arrive.
 * Mounted once in AppShell.
 */
export function useGlobalEvents(): void {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/events");
    const pendingInvalidations = new Set<string>();

    es.addEventListener("message", (event) => {
      // Coalesce invalidations — collect all affected query keys, flush on debounce
      let parsed: { type?: string; rigId?: string } = {};
      try { parsed = JSON.parse(event.data); } catch { /* ignore */ }

      const { type, rigId } = parsed;
      if (!type) return;

      // Collect affected query keys
      if (type.startsWith("node.startup_") && rigId) {
        pendingInvalidations.add(`rig:${rigId}:nodes`);
      }
      if (type === "rig.created" || type === "rig.deleted" || type === "rig.stopped" ||
          type === "rig.imported" ||
          type === "bootstrap.completed" || type === "bootstrap.partial") {
        pendingInvalidations.add("rigs:summary");
        pendingInvalidations.add("ps");
      }
      if (type === "restore.completed" && rigId) {
        pendingInvalidations.add("rigs:summary");
        pendingInvalidations.add("ps");
        pendingInvalidations.add(`rig:${rigId}:nodes`);
      }

      // Schedule flush
      if (debounceRef.current) return; // Already scheduled
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;

        // Flush all pending invalidations
        for (const key of pendingInvalidations) {
          if (key === "rigs:summary") {
            queryClient.invalidateQueries({ queryKey: ["rigs", "summary"] });
          } else if (key === "ps") {
            queryClient.invalidateQueries({ queryKey: ["ps"] });
          } else if (key.startsWith("rig:")) {
            const parts = key.split(":");
            queryClient.invalidateQueries({ queryKey: ["rig", parts[1], parts[2]] });
          }
        }
        pendingInvalidations.clear();
      }, 150);
    });

    return () => {
      es.close();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [queryClient]);
}
