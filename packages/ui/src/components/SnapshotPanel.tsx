import { useState } from "react";
import { useSnapshots } from "../hooks/useSnapshots.js";
import { useCreateSnapshot, useRestoreSnapshot } from "../hooks/mutations.js";
import { usePsEntries } from "../hooks/usePsEntries.js";
import { getRestoreStatusColorClass } from "../lib/restore-status-colors.js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface RestoreNodeResult {
  nodeId: string;
  logicalId: string;
  status: string;
  error?: string;
}

interface SnapshotPanelProps {
  rigId: string;
}

function formatAge(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function SnapshotPanel({ rigId }: SnapshotPanelProps) {
  const { data: snapshots = [], isPending: loading, error: fetchError } = useSnapshots(rigId);
  const { data: psEntriesData } = usePsEntries();
  const createSnapshot = useCreateSnapshot(rigId);
  const restoreSnapshot = useRestoreSnapshot(rigId);
  const psEntries = Array.isArray(psEntriesData) ? psEntriesData : [];
  const rigPsEntry = psEntries.find((entry) => entry.rigId === rigId);
  const restoreBlocked = rigPsEntry?.status === "running" || rigPsEntry?.status === "partial";

  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreNodeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = () => {
    setError(null);
    createSnapshot.mutate(undefined, {
      onError: (err) => setError(err.message),
    });
  };

  const handleRestore = (snapshotId: string) => {
    setError(null);
    setRestoreResult(null);
    restoreSnapshot.mutate(snapshotId, {
      onSuccess: (data) => {
        setRestoreResult((data as { nodes?: RestoreNodeResult[] }).nodes ?? []);
        setConfirmRestore(null);
      },
      onError: (err) => {
        setError(err.message);
        setConfirmRestore(null);
      },
    });
  };

  return (
    <div data-testid="snapshot-panel" className="card-dark bg-noise-dark p-spacing-4 max-h-[40vh] lg:max-h-none lg:min-w-[260px] lg:max-w-[300px] overflow-y-auto shrink-0">
      {/* Header */}
      <div className="flex justify-between items-center mb-spacing-4">
        <h3 className="text-headline-md uppercase text-foreground-on-dark tracking-[0.02em]">SNAPSHOTS</h3>
        <button
          className="px-spacing-3 py-spacing-1 text-label-md uppercase tracking-[0.04em] text-foreground-on-dark bg-white/10 border border-white/15 hover:bg-white/20 transition-all disabled:opacity-50"
          onClick={handleCreate}
          disabled={createSnapshot.isPending}
        >
          {createSnapshot.isPending ? "CREATING..." : "CREATE"}
        </button>
      </div>

      {/* Error */}
      {(error ?? fetchError?.message) && (
        <div data-testid="restore-error" className="mb-spacing-3 p-spacing-3 bg-destructive/20 text-destructive text-label-md">
          {error ?? fetchError?.message}
        </div>
      )}

      {restoreBlocked && (
        <div data-testid="restore-blocked-message" className="mb-spacing-3 text-label-sm text-foreground-muted-on-dark/70">
          Stop the rig before restoring a snapshot.
        </div>
      )}

      {/* Restore result */}
      {restoreResult && (
        <div data-testid="restore-result" className="mb-spacing-4 p-spacing-3 inset-dark">
          <div className="text-label-sm uppercase text-foreground-muted-on-dark/60 tracking-[0.06em] mb-spacing-2">RESTORE COMPLETE</div>
          <div className="space-y-spacing-1">
            {restoreResult.map((n) => (
              <div key={n.nodeId} className="flex items-center justify-between text-label-md">
                <span className="font-mono text-foreground-on-dark">{n.logicalId}</span>
                <span className={`font-mono ${getRestoreStatusColorClass(n.status)}`} data-testid={`restore-status-${n.logicalId}`}>
                  {n.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Restore loading */}
      {restoreSnapshot.isPending && (
        <div data-testid="restore-loading" className="text-label-md text-foreground-muted-on-dark mb-spacing-3">
          Restoring...
        </div>
      )}

      {/* Snapshot list */}
      {loading ? (
        <div data-testid="snapshot-loading" className="space-y-spacing-2">
          {[1, 2].map((i) => (
            <div key={i} className="inset-dark p-spacing-3">
              <div className="h-4 w-32 shimmer-dark mb-spacing-2" />
              <div className="h-3 w-48 shimmer-dark" />
            </div>
          ))}
        </div>
      ) : snapshots.length === 0 ? (
        <div className="text-label-md text-foreground-muted-on-dark/50 py-spacing-4 text-center">
          No snapshots yet
        </div>
      ) : (
        <div className="space-y-spacing-2">
          {snapshots.map((snap) => (
            <div key={snap.id} className="inset-dark p-spacing-3 transition-colors duration-150 hover:bg-white/5">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-mono text-label-md text-foreground-on-dark" data-testid={`snap-id-${snap.id}`}>
                    {snap.id.slice(0, 12)}
                  </div>
                  <div className="text-label-sm text-foreground-muted-on-dark mt-spacing-1">
                    {snap.kind} &middot; {formatAge(snap.createdAt)}
                  </div>
                </div>
                <button
                  className="px-spacing-3 py-spacing-1 text-label-md uppercase tracking-[0.04em] text-foreground-muted-on-dark bg-white/6 border border-white/10 hover:bg-white/12 hover:text-foreground-on-dark transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/6 disabled:hover:text-foreground-muted-on-dark"
                  data-testid={`restore-btn-${snap.id}`}
                  disabled={restoreBlocked || restoreSnapshot.isPending}
                  onClick={() => setConfirmRestore(snap.id)}
                >
                  RESTORE
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation dialog */}
      <Dialog open={confirmRestore !== null} onOpenChange={(open) => { if (!open) setConfirmRestore(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-headline-md">Restore Snapshot</DialogTitle>
            <DialogDescription className="text-body-sm text-foreground-muted">
              This will restore the rig from snapshot {confirmRestore?.slice(0, 12)} after any running sessions have been stopped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              data-testid={confirmRestore ? `cancel-restore-${confirmRestore}` : undefined}
              onClick={() => setConfirmRestore(null)}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              data-testid={confirmRestore ? `confirm-restore-${confirmRestore}` : undefined}
              disabled={restoreBlocked || restoreSnapshot.isPending}
              onClick={() => confirmRestore && handleRestore(confirmRestore)}
            >
              Confirm Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
