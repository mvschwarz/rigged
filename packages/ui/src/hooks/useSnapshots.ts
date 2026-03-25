import { useState, useEffect, useCallback } from "react";

interface Snapshot {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
}

export function useSnapshots(rigId: string) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rigs/${rigId}/snapshots`);
      if (!res.ok) {
        setError(`Failed to load snapshots (HTTP ${res.status})`);
        return;
      }
      const data = await res.json();
      setSnapshots(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load snapshots");
    } finally {
      setLoading(false);
    }
  }, [rigId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { snapshots, loading, error, refresh };
}
