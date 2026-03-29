import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useDiscoveredSessions,
  useClaimSession,
  useDiscoveryPoll,
  type DiscoveredSession,
} from "../hooks/useDiscovery.js";

function confidenceColor(confidence: string): string {
  switch (confidence) {
    case "highest": return "text-success";
    case "high": return "text-success";
    case "medium": return "text-warning";
    case "low": return "text-foreground-muted";
    default: return "text-foreground-muted";
  }
}

function runtimeColor(hint: string): string {
  switch (hint) {
    case "claude-code": return "bg-primary";
    case "codex": return "bg-accent";
    case "terminal": return "bg-foreground-muted";
    default: return "bg-foreground-muted";
  }
}

function DiscoveredSessionCard({ session, onClaim }: { session: DiscoveredSession; onClaim: (id: string) => void }) {
  const isDimmed = session.status === "vanished";

  return (
    <div
      data-testid="discovered-node"
      className={cn(
        "border-dashed border border-foreground/20 p-spacing-4 mb-spacing-2",
        isDimmed ? "opacity-40" : "",
      )}
    >
      <div className="flex items-center gap-spacing-3 mb-spacing-1">
        <span data-testid="runtime-badge" className={cn("px-spacing-2 py-px text-label-sm uppercase", runtimeColor(session.runtimeHint))}>
          {session.runtimeHint}
        </span>
        <span data-testid="confidence-badge" className={cn("text-label-sm font-mono", confidenceColor(session.confidence))}>
          {session.confidence}
        </span>
        {isDimmed && <span className="text-label-sm text-destructive uppercase">VANISHED</span>}
      </div>
      <div className="text-label-sm font-mono text-foreground-muted">
        {session.tmuxSession}:{session.tmuxPane}
      </div>
      {session.cwd && (
        <div className="text-label-sm font-mono text-foreground-muted truncate">{session.cwd}</div>
      )}
      {session.status === "active" && (
        <Button
          variant="tactical"
          size="sm"
          data-testid="claim-btn"
          className="mt-spacing-2"
          onClick={() => onClaim(session.id)}
        >
          CLAIM
        </Button>
      )}
    </div>
  );
}

export function DiscoveryOverlay() {
  const { data: sessions = [] } = useDiscoveredSessions();
  useDiscoveryPoll(30_000);
  const claimMutation = useClaimSession();
  const visibleSessions = sessions.filter((session) => session.status !== "claimed");

  const [claimTarget, setClaimTarget] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rigId, setRigId] = useState("");
  const [logicalId, setLogicalId] = useState("");

  const handleClaimClick = (discoveredId: string) => {
    setClaimTarget(discoveredId);
    setDialogOpen(true);
    setRigId("");
    setLogicalId("");
    claimMutation.reset();
  };

  const handleClaimConfirm = () => {
    if (!claimTarget || !rigId) return;
    claimMutation.mutate(
      { discoveredId: claimTarget, rigId, logicalId: logicalId || undefined },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setClaimTarget(null);
        },
      },
    );
  };

  if (visibleSessions.length === 0) {
    return (
      <div className="p-spacing-6" data-testid="discovery-empty">
        <p className="text-body-md text-foreground-muted">No discovered sessions</p>
      </div>
    );
  }

  return (
    <div className="p-spacing-6" data-testid="discovery-overlay">
      <h3 className="text-headline-md uppercase mb-spacing-4">DISCOVERED SESSIONS</h3>

      {visibleSessions.map((s) => (
        <DiscoveredSessionCard key={s.id} session={s} onClaim={handleClaimClick} />
      ))}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="claim-dialog">
          <DialogHeader>
            <DialogTitle className="text-headline-md uppercase">CLAIM SESSION</DialogTitle>
            <DialogDescription>Adopt this session into a managed rig.</DialogDescription>
          </DialogHeader>
          <div className="space-y-spacing-3">
            <div>
              <label className="text-label-sm uppercase block mb-spacing-1">RIG ID</label>
              <input
                data-testid="claim-rig-input"
                type="text"
                value={rigId}
                onChange={(e) => setRigId(e.target.value)}
                className="w-full bg-transparent border-b border-foreground/20 py-spacing-1 text-body-md font-mono focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-label-sm uppercase block mb-spacing-1">LOGICAL ID (optional)</label>
              <input
                data-testid="claim-logical-input"
                type="text"
                value={logicalId}
                onChange={(e) => setLogicalId(e.target.value)}
                className="w-full bg-transparent border-b border-foreground/20 py-spacing-1 text-body-md font-mono focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          {claimMutation.isError && (
            <p className="text-destructive text-label-sm" data-testid="claim-error">
              {claimMutation.error?.message}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>CANCEL</Button>
            <Button
              variant="tactical"
              onClick={handleClaimConfirm}
              disabled={!rigId || claimMutation.isPending}
              data-testid="claim-confirm"
            >
              {claimMutation.isPending ? "CLAIMING..." : "CLAIM"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
