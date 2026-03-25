/**
 * Maps instantiate node result status to Tailwind text color class.
 * These are DIFFERENT from restore statuses and runtime node statuses.
 * Instantiate statuses: launched, failed.
 */
export function getInstantiateStatusColorClass(status: string): string {
  switch (status) {
    case "launched":
      return "text-success";
    case "failed":
      return "text-destructive";
    default:
      return "text-foreground-muted";
  }
}
