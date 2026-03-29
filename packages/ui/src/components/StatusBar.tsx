import { useRef, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RigSummary } from "../hooks/useRigSummary.js";

async function fetchHealth(): Promise<boolean> {
  const res = await fetch("/healthz");
  if (!res.ok) throw new Error("unhealthy");
  return true;
}

async function fetchSummary(): Promise<RigSummary[]> {
  const res = await fetch("/api/rigs/summary");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchCmux(): Promise<{ available: boolean }> {
  const res = await fetch("/api/adapters/cmux/status");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

interface StatusBarProps {
  onToggleFeed?: () => void;
  feedOpen?: boolean;
  eventCount?: number;
}

export function StatusBar({ onToggleFeed, feedOpen, eventCount }: StatusBarProps = {}) {
  const healthQuery = useQuery({
    queryKey: ["daemon", "health"],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
    retry: false,
  });

  const summaryQuery = useQuery({
    queryKey: ["rigs", "summary"],
    queryFn: fetchSummary,
    refetchInterval: 30_000,
  });

  const cmuxQuery = useQuery({
    queryKey: ["daemon", "cmux"],
    queryFn: fetchCmux,
    refetchInterval: 30_000,
  });

  const isConnected = healthQuery.isSuccess;

  const queryClient = useQueryClient();
  const prevConnectedRef = useRef<boolean | null>(null);
  const [reconnectPulse, setReconnectPulse] = useState(false);

  useEffect(() => {
    if (prevConnectedRef.current === false && isConnected) {
      setReconnectPulse(true);
      const timer = setTimeout(() => setReconnectPulse(false), 600);
      queryClient.invalidateQueries({ queryKey: ["rigs", "summary"] });
      queryClient.invalidateQueries({ queryKey: ["daemon", "cmux"] });
      prevConnectedRef.current = isConnected;
      return () => clearTimeout(timer);
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected, queryClient]);

  const rigCount = isConnected ? (summaryQuery.data?.length ?? null) : null;
  const cmuxAvailable = isConnected ? (cmuxQuery.data?.available ?? null) : null;

  return (
    <footer
      data-testid="status-bar"
      className="h-10 flex items-center px-spacing-4 gap-spacing-3 border-t border-stone-300 bg-background shrink-0"
    >
      {/* Health pill */}
      <div className="bg-white/90 border border-stone-900 px-3 py-0.5 font-mono text-[10px] flex items-center gap-2">
        <div
          data-testid="health-dot"
          className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-success animate-pulse" : "bg-tertiary"} ${reconnectPulse ? "status-changed" : ""}`}
        />
        <span data-testid="health-text">
          {isConnected ? "SYSTEM_STABLE" : "DISCONNECTED"}
        </span>
      </div>

      {/* Rig count pill */}
      <div className="bg-white/90 border border-stone-900 px-3 py-0.5 font-mono text-[10px]" data-testid="rig-count">
        RIGS: {rigCount ?? "\u2014"}
      </div>

      {/* CMUX pill */}
      <div className="bg-white/90 border border-stone-300 px-3 py-0.5 font-mono text-[10px] text-stone-500" data-testid="cmux-status">
        CMUX: {cmuxAvailable === null ? "\u2014" : cmuxAvailable ? "OK" : "UNAVAIL"}
      </div>

      {/* Activity feed toggle — right aligned */}
      {onToggleFeed && (
        <>
          <span className="flex-1" />
          <button
            data-testid="feed-toggle"
            onClick={onToggleFeed}
            className="bg-white/90 border border-stone-900 px-3 py-0.5 font-mono text-[10px] hover:bg-stone-900 hover:text-white transition-all"
            aria-label="Toggle activity feed"
            aria-expanded={feedOpen}
          >
            ACTIVITY{(eventCount ?? 0) > 0 ? ` ${eventCount}` : ""}
          </button>
        </>
      )}
    </footer>
  );
}
