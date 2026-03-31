# CLI/UI Workflow Audit — North Star

Task: NS-T14
Date: 2026-03-31
Author: r01-dev1-impl@rigged-buildout

---

## Workflow 1: Boot a rig from UI (Explorer Turn On)

**Current path:** Explorer sidebar → expand stopped rig → click "Turn On" → POST /api/rigs/:rigId/up → restore from auto-pre-down snapshot.

**Friction:**
- Turn On only works if an auto-pre-down snapshot exists (from a prior `rigged down`). If the rig was created but never stopped, Turn On returns 404. **Non-blocking** — expected behavior, error message guides to spec path.
- Explorer doesn't refresh automatically after Turn On completes. User must wait for SSE event to trigger invalidation. **Non-blocking** — SSE invalidation is wired via useGlobalEvents.

**Error quality:** Good. 404 response includes "no auto-pre-down snapshot" with guidance.

**Agent usability:** Good. The Turn On button is visible and the Explorer tree shows status transitions.

---

## Workflow 2: Boot a rig from CLI (`rigged up`)

**Current path:** `rigged up <spec.yaml>` → POST /api/up → bootstrap orchestrator → instantiation → startup.

**Friction:**
- Fresh boot handoff now includes dashboard URL + attach command (NS-T07). **Resolved.**
- `rigged up` auto-starts daemon if not running. **No friction.**

**Error quality:** Good. Validation failures show per-field errors with "Fix:" guidance (NS-T08).

**Agent usability:** Excellent. `--json` on everything. Error messages tell what to do next.

---

## Workflow 3: Resume after reboot (`rigged up <name>`)

**Current path:** `rigged up auth-feats` → UpCommandRouter detects rig name → find rig by name → find latest auto-pre-down snapshot → restore.

**Friction:**
- Requires the rig to have been stopped with `rigged down` (which auto-snapshots). If the machine rebooted without a clean `rigged down`, no auto-pre-down snapshot exists. **Non-blocking** — the error message guides to manual restore or fresh boot.
- Duplicate rig names produce ambiguity error with rig IDs listed. **Resolved in NS-T06.**

**Error quality:** Good. "No rig found" or "no auto-pre-down snapshot" with specific suggestions.

**Agent usability:** Good. The agent learns the `rigged up <name>` pattern from the down handoff output.

---

## Workflow 4: Create rig from organic topology (discover → draft → import)

**Current path:** `rigged discover` → scan → `rigged discover --draft` → YAML to stdout → pipe to file → `rigged import --instantiate <file>`.

**Friction:**
- UI "Generate Rig Spec" button now connected to POST /api/discovery/draft-rig (NS-T14 fix). **Resolved.**
- Draft spec uses placeholder `agent_ref: local:agents/{id}` which fails preflight. User must edit before import. **Non-blocking** — expected, the draft is a starting point.
- Unknown runtime sessions excluded with warning comments in YAML. **Resolved in NS-T13.**

**Error quality:** Good. Warnings embedded as YAML comments. Import errors guide to validation.

**Agent usability:** Good. `rigged discover --draft > draft.yaml && rigged rig validate draft.yaml` is a natural workflow.

---

## Workflow 5: Connect to any agent (UI click → copy attach)

**Current path:** Explorer → expand rig → click node → detail panel opens → "Copy tmux attach" button.

**Friction:**
- Copy uses `navigator.clipboard` which requires HTTPS or localhost. **Non-blocking** — localhost is the deployment context.
- Graph node click also triggers cmux focus (when available). Selection is secondary effect. **Non-blocking** — both behaviors useful.

**Error quality:** N/A — copy is fire-and-forget.

**Agent usability:** Good via MCP: `rigged_rig_nodes` returns `tmuxAttachCommand` directly.

---

## Workflow 6: Monitor and intervene (dashboard → detect failure → recover)

**Current path:** Dashboard → rig card → click → graph view → see node status colors → click failed node → detail panel shows error → decide action.

**Friction:**
- SSE updates Explorer status dots and graph node colors in real time (useGlobalEvents). **No friction.**
- Failed nodes show error prominently in red with detail panel error section. **Resolved in NS-T11.**
- No "retry startup" button in the detail panel — user must use CLI `rigged restore`. **Non-blocking** — CLI is the primary action surface for agents.

**Error quality:** Good. Failures visible in Explorer, graph, and detail panel simultaneously.

**Agent usability:** Good. `rigged ps --nodes` shows startup status and errors. Agent can script recovery.

---

## Workflow 7: Share a rig (export/bundle)

**Current path:** `rigged export <rigId>` → YAML to stdout. `rigged bundle create <spec.yaml>` → .rigbundle file.

**Friction:**
- Export round-trips validated in AgentSpec reboot (CP3). **No friction.**
- Bundle create + inspect + install all work for both v1 and v2 formats. **No friction.**

**Error quality:** Good. Error messages include guidance (NS-T08).

**Agent usability:** Excellent. `rigged export <rigId> | rigged rig validate /dev/stdin` for verification.

---

## Demo-Blocking Findings

| # | Finding | Status |
|---|---------|--------|
| 1 | DiscoveryOverlay "Generate Rig Spec" button not connected | **Fixed** (NS-T14) |
| 2 | NS-T07 handoff output tests missing for 4 commands | **Fixed** (NS-T14 — tests added) |
| 3 | No "retry startup" button in detail panel | Non-blocking |
| 4 | Draft spec placeholder agent_ref fails preflight | Non-blocking (expected) |
| 5 | Turn On requires prior auto-pre-down snapshot | Non-blocking (expected) |

## Summary

All 7 workflows are functional. Two demo-blocking items fixed in this task. Three non-blocking items documented for future improvement. Error messages follow the what+why+what-to-do pattern consistently across all product-loop commands.
