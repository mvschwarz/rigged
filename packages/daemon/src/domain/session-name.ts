// Phase 1: Rigged-managed sessions only.
// Names must match: r{NN}-{cluster}{N}-{role}
// Examples: r01-dev1-impl, r01-orch1-lead, r01-rev1-r1
const SESSION_NAME_PATTERN = /^r\d{2}-.+\d+-.+$/;

export function validateSessionName(name: string): boolean {
  return SESSION_NAME_PATTERN.test(name);
}

export function deriveSessionName(
  rigName: string,
  logicalId: string
): string {
  return `${rigName}-${logicalId}`;
}
