// Phase 1: Rigged-managed sessions only.
// Names must start with r{NN}- prefix then any non-empty suffix.
// Examples: r01-dev1-impl, r01-orchestrator, r01-worker, r01-orch1-lead
const SESSION_NAME_PATTERN = /^r\d{2}-.+$/;
const MANAGED_STEM_PATTERN = /^r\d{2}(?:-|$)/;

export function validateSessionName(name: string): boolean {
  return SESSION_NAME_PATTERN.test(name);
}

export function deriveSessionName(
  rigName: string,
  logicalId: string
): string {
  const stem = MANAGED_STEM_PATTERN.test(rigName) ? rigName : `r00-${rigName}`;
  // tmux replaces dots with underscores in session names — normalize to match
  const safeId = logicalId.replace(/\./g, "_");
  return `${stem}-${safeId}`;
}
