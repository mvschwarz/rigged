/**
 * Maps restore node result status to Tailwind text color class.
 * Vocabulary: resumed / rebuilt / fresh / failed / n-a
 */
export function getRestoreStatusColorClass(status: string): string {
  switch (status) {
    case "resumed":
      return "text-success";
    case "rebuilt":
      return "text-success";
    case "fresh":
      return "text-foreground-muted";
    case "failed":
      return "text-destructive";
    // Compat: old persisted values
    case "checkpoint_written":
      return "text-success";
    case "fresh_no_checkpoint":
      return "text-foreground-muted";
    default:
      return "text-foreground-muted";
  }
}
