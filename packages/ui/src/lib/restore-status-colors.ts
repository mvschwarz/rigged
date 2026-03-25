/**
 * Maps restore node result status to Tailwind text color class.
 */
export function getRestoreStatusColorClass(status: string): string {
  switch (status) {
    case "resumed":
      return "text-success";
    case "checkpoint_written":
      return "text-success";
    case "fresh_no_checkpoint":
      return "text-foreground-muted";
    case "failed":
      return "text-destructive";
    default:
      return "text-foreground-muted";
  }
}
