/**
 * Maps node status to Tailwind background color class per design-system.md §2.
 */
export function getStatusColorClass(status: string | null): string {
  switch (status) {
    case "running":
      return "bg-primary";
    case "idle":
      return "bg-foreground-muted";
    case "exited":
      return "bg-destructive";
    case "detached":
      return "bg-warning";
    case "unknown":
    default:
      return "bg-foreground-muted/50";
  }
}
