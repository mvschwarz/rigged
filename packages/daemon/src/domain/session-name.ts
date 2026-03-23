// Phase 1: Rigged-managed sessions only.
// Names must start with r{NN}- prefix then any non-empty suffix.
// Examples: r01-dev1-impl, r01-orchestrator, r01-worker, r01-orch1-lead
const SESSION_NAME_PATTERN = /^r\d{2}-.+$/;

export function validateSessionName(name: string): boolean {
  return SESSION_NAME_PATTERN.test(name);
}

export function deriveSessionName(
  rigName: string,
  logicalId: string
): string {
  return `${rigName}-${logicalId}`;
}
