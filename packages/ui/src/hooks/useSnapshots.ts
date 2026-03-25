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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rigs/${rigId}/snapshots`);
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data);
      }
    } finally {
      setLoading(false);
    }
  }, [rigId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { snapshots, loading, refresh };
}
