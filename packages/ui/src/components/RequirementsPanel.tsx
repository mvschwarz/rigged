import { cn } from "@/lib/utils";

export interface RequirementResult {
  name: string;
  kind: string;
  status: string;
  version: string | null;
  detectedPath: string | null;
}

function statusDot(status: string): string {
  switch (status) {
    case "installed": return "bg-success";
    case "missing": return "bg-destructive";
    case "unsupported": return "bg-warning";
    case "unknown": return "bg-warning";
    default: return "bg-foreground-muted";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "installed": return "OK";
    case "missing": return "MISSING";
    case "unsupported": return "MANUAL";
    case "unknown": return "UNKNOWN";
    default: return status.toUpperCase();
  }
}

export function RequirementsPanel({ results }: { results: RequirementResult[] }) {
  if (results.length === 0) {
    return (
      <div className="text-body-sm text-foreground-muted" data-testid="no-requirements">
        No requirements declared.
      </div>
    );
  }

  return (
    <div className="space-y-spacing-1" data-testid="requirements-panel">
      {results.map((r) => (
        <div
          key={`${r.kind}:${r.name}`}
          data-testid="requirement-row"
          className="flex items-center gap-spacing-3 py-spacing-1 text-label-sm font-mono"
        >
          <span
            data-testid="requirement-dot"
            className={cn("w-2 h-2 shrink-0", statusDot(r.status))}
          />
          <span
            data-testid="requirement-status"
            className="w-16 uppercase"
          >
            {statusLabel(r.status)}
          </span>
          <span className="text-foreground-muted w-24">{r.kind}</span>
          <span>{r.name}</span>
          {r.detectedPath && (
            <span className="text-foreground-muted ml-auto truncate max-w-[200px]">
              {r.detectedPath}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
