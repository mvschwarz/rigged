/**
 * Maps node status to Tailwind background color class.
 */
export function getStatusColorClass(status: string | null): string {
  switch (status) {
    case "running":
      return "bg-success";
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
