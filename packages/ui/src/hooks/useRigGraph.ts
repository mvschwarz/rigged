import { useState, useEffect } from "react";

interface GraphData {
  nodes: unknown[];
  edges: unknown[];
}

type FetchStatus = "idle" | "loading" | "success" | "error";

interface UseRigGraphResult {
  nodes: unknown[];
  edges: unknown[];
  loading: boolean;
  error: string | null;
}

export function useRigGraph(rigId: string | null): UseRigGraphResult {
  const [data, setData] = useState<GraphData | null>(null);
  // Start as loading when rigId is present (avoids empty-state flash)
  const [status, setStatus] = useState<FetchStatus>(rigId ? "loading" : "idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rigId) {
      setData(null);
      setStatus("idle");
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError(null);

    fetch(`/api/rigs/${rigId}/graph`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: GraphData) => {
        if (!cancelled) {
          setData(json);
          setStatus("success");
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rigId]);

  return {
    nodes: data?.nodes ?? [],
    edges: data?.edges ?? [],
    loading: status === "loading",
    error,
  };
}
