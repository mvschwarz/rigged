# Phase 2 Task Breakdown — Snapshot + Same-Machine Restore

Pair: r01-dev1 (impl + qa)
Date: 2026-03-23
Status: REVISED — incorporates peer + QA + architect review feedback
Revision: 3

---

## Conventions

- **Risk**: Standard or **HIGH** (needs architect/QA sign-off before implementation)
- **Depends on**: task IDs that must be complete first
- **Test**: what proves the task is done
- **Files**: primary files created or modified
- Each task = pre-edit gate → TDD (RED/GREEN) → post-edit gate → commit

---

## Architecture Rules (carried from Phase 1)

- Domain logic is framework-agnostic (zero Hono imports in `domain/` or `adapters/`)
- Event bus for state changes (snapshot.created, restore.started, restore.completed)
- cmux degraded mode (restore works without cmux, just no surface placement)
- RestoreOrchestrator **uses** NodeLauncher — does not duplicate launch logic
- Same db handle enforced across all domain services
- Snapshot is a hybrid: JSON blob for full state, metadata columns for querying

---

## Review Fixes Applied

1. **Resume metadata**: Added P2-T02b — Phase 2 migration adds `resume_type`, `resume_token`, and `restore_policy` to sessions table (all three per PRD:472-474). Resume adapters use `resume_type` to select CLI command. RestoreOrchestrator uses `restore_policy` to decide whether to attempt resume at all.
2. **Stale-binding repair**: RestoreOrchestrator (P2-T07) explicitly clears stale bindings/sessions before relaunching each node. Test added.
3. **Codex resume CLI**: P2-T06 notes that Codex resume syntax must be verified against installed CLI help before implementation. Exact command locked by test.
4. **P2-T04 reclassified**: CheckpointStore is now HIGH risk (recovery quality depends on query contract).
5. **No parallel arrays**: SnapshotData.checkpoints changed from `(Checkpoint | null)[]` to `Record<string, Checkpoint | null>` keyed by node id.
6. **Explicit dependency policy**: Only `delegates_to` and `spawned_by` edges constrain launch order. Other edge kinds (`can_observe`, `messaged`) are informational. Topological sort with alphabetical tiebreaker within same depth. Test asserts exact order AND proves non-dependency edges don't constrain it.
7. **Auto-snapshots deferred**: P2-T10 removed from Phase 2. Deferred to Phase 2b until manual snapshot/restore is proven stable.

---

## Layer 0: Schema

### P2-T01 — Snapshot schema

| Field | Value |
|---|---|
| Risk | **HIGH** — foundational for all restore operations |
| Depends on | Phase 1 complete |
| Files | `src/db/migrations/004_snapshots.ts`, `test/schema-snapshots.test.ts` |
| Test | Migration creates table. Insert snapshot with JSON blob + metadata. Query by rig_id. Query by kind. Order by created_at. Rig delete does NOT delete snapshots (plain TEXT rig_id, not FK). |

Schema:

```sql
CREATE TABLE snapshots (
  id          TEXT PRIMARY KEY,
  rig_id      TEXT NOT NULL,       -- plain TEXT, not FK (survives rig deletion)
  kind        TEXT NOT NULL,       -- 'manual', 'pre_restore'
  status      TEXT NOT NULL DEFAULT 'complete',  -- 'complete', 'partial', 'failed'
  data        TEXT NOT NULL,       -- JSON blob: full rig state
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_snapshots_rig ON snapshots(rig_id, created_at);
```

### P2-T02 — Checkpoint schema

| Field | Value |
|---|---|
| Risk | **HIGH** — per-agent recovery depends on this shape |
| Depends on | Phase 1 complete |
| Files | `src/db/migrations/005_checkpoints.ts`, `test/schema-checkpoints.test.ts` |
| Test | Migration creates table. Insert checkpoint for a node. Query latest checkpoint per node. Multiple checkpoints per node (history). FK to nodes.id with CASCADE. |

Schema:

```sql
CREATE TABLE checkpoints (
  id              TEXT PRIMARY KEY,
  node_id         TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  summary         TEXT NOT NULL,
  current_task    TEXT,
  next_step       TEXT,
  blocked_on      TEXT,
  key_artifacts   TEXT,       -- JSON array of strings
  confidence      TEXT,       -- 'high', 'medium', 'low'
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_checkpoints_node ON checkpoints(node_id, created_at);
```

### P2-T02b — Resume and restore metadata migration

| Field | Value |
|---|---|
| Risk | **HIGH** — these three fields drive the entire restore decision tree |
| Depends on | Phase 1 complete |
| Files | `src/db/migrations/006_resume_metadata.ts`, `test/schema-resume-metadata.test.ts` |
| Test | Migration adds three columns to sessions table. Existing sessions get NULLs (no data loss). Insert session with all three fields. Query returns all three. Update resume_type independently. restore_policy defaults to 'resume_if_possible' when not set. |

Schema:

```sql
ALTER TABLE sessions ADD COLUMN resume_type TEXT;
  -- claude_name | claude_id | codex_id | codex_last | none
ALTER TABLE sessions ADD COLUMN resume_token TEXT;
  -- the actual value: session name, session ID, etc.
ALTER TABLE sessions ADD COLUMN restore_policy TEXT NOT NULL DEFAULT 'resume_if_possible';
  -- resume_if_possible | relaunch_fresh | checkpoint_only
```

**Why all three fields (from PRD):**

- **`resume_type`** tells the restore adapter HOW to resume — which CLI command/flag to use. Claude supports resume by name (`claude --resume {name}`) and by ID. Codex supports resume by session ID and by "last session." Without this, the orchestrator can't pick the right adapter or command shape.
- **`resume_token`** is the actual value to pass to the resume command.
- **`restore_policy`** tells the orchestrator WHETHER to attempt resume at all. A node with `relaunch_fresh` should never attempt resume even if it has a valid token. A node with `checkpoint_only` should write the checkpoint file but not try to resume the prior conversation.

Notes:
- Phase 1 regression test asserting `resume_token` absent should be updated.
- SessionRegistry and Session type updated to include all three fields.
- `restore_policy` has a DEFAULT so existing sessions and Phase 1 code don't break.

---

## Layer 1: Domain — Data Access

### P2-T03 — SnapshotRepository

| Field | Value |
|---|---|
| Risk | **HIGH** — query patterns affect restore performance and correctness |
| Depends on | P2-T01 |
| Files | `src/domain/snapshot-repository.ts`, `test/snapshot-repository.test.ts` |
| Test | `createSnapshot(rigId, kind, data)` → persists + returns typed Snapshot. `getSnapshot(id)` → returns with parsed JSON data. `getLatestSnapshot(rigId)` → most recent by created_at. `listSnapshots(rigId, opts?)` → filtered by kind, limited count. `pruneSnapshots(rigId, keepCount)` → deletes oldest beyond keepCount. All tests use in-memory DB. |

Notes:
- Pure TypeScript. Zero Hono imports.
- `data` field stored as JSON string, returned as parsed `SnapshotData`.
- Snapshot type added to `types.ts`.

### P2-T04 — CheckpointStore

| Field | Value |
|---|---|
| Risk | **HIGH** — recovery quality depends on query contract; wrong latest-checkpoint logic = wrong restore context |
| Depends on | P2-T02 |
| Files | `src/domain/checkpoint-store.ts`, `test/checkpoint-store.test.ts` |
| Test | `createCheckpoint(nodeId, data)` → persists. `getLatestCheckpoint(nodeId)` → most recent by created_at. `getCheckpointsForNode(nodeId)` → all, ordered by created_at. `getCheckpointsForRig(rigId)` → returns `Record<string, Checkpoint | null>` keyed by node id (latest per node, null for nodes without checkpoints). |

Notes:
- Pure TypeScript. Zero Hono imports.
- `key_artifacts` stored as JSON string, returned as `string[]`.
- `getCheckpointsForRig` is the primary query for snapshot capture — avoids parallel arrays by returning a map.

---

## Layer 2: Domain — Capture

### P2-T05 — Snapshot capture service

| Field | Value |
|---|---|
| Risk | **HIGH** — this assembles the truth document for restore |
| Depends on | P2-T03, P2-T04, P2-T02b |
| Files | `src/domain/snapshot-capture.ts`, `test/snapshot-capture.test.ts` |
| Test | `captureSnapshot(rigId, kind)` → gathers rig (nodes + edges + bindings), sessions (with resume tokens), checkpoints (as map). Assembles SnapshotData JSON. Persists via SnapshotRepository. Emits `snapshot.created` event. Returns Snapshot. Empty rig (no nodes) → valid snapshot with empty collections. Node with no checkpoint → null in checkpoints map. |

Notes:
- Pure TypeScript. Injected deps: RigRepository, SessionRegistry, CheckpointStore, SnapshotRepository, EventBus.
- Same db handle invariant enforced at construction.
- Does NOT lock or pause the system — it's a point-in-time observation.

---

## Layer 3: Adapters — Resume

### P2-T06 — Codex resume adapter

| Field | Value |
|---|---|
| Risk | **HIGH** — harness-specific behavior; wrong CLI syntax = failed restore |
| Depends on | Phase 1 TmuxAdapter, P2-T02b |
| Files | `src/adapters/codex-resume.ts`, `test/codex-resume.test.ts` |
| Test | `canResume(resumeToken)` → checks if codex resume is available. `resume(tmuxSessionName, resumeToken, cwd)` → sends exact resume command into tmux session. Mock exec: verify exact command shape. Resume not available → returns `{ ok: false, code: 'no_resume' }`. Resume fails → returns typed error. |

Notes:
- **IMPORTANT**: Before implementation, verify actual Codex CLI resume syntax by running `codex --help` or `codex resume --help`. The exact command shape (`codex --resume {id}` vs `codex resume {id}`) must be grounded in installed CLI help output, not guessed.
- Uses TmuxAdapter.sendText to inject the resume command into a tmux session.
- Reads `resume_token` from session metadata.

### P2-T06b — Claude resume adapter

| Field | Value |
|---|---|
| Risk | **HIGH** — harness-specific behavior; wrong detection = failed restore |
| Depends on | Phase 1 TmuxAdapter, P2-T02b |
| Files | `src/adapters/claude-resume.ts`, `test/claude-resume.test.ts` |
| Test | `canResume(resumeToken)` → checks if claude --resume is available for the session. `resume(tmuxSessionName, resumeToken, cwd)` → sends exact `claude --resume {resumeToken}` command into tmux session. Mock exec: verify exact command shape. Resume not available → returns `{ ok: false, code: 'no_resume' }`. Resume fails → returns typed error. |

Notes:
- Uses TmuxAdapter.sendText to inject the resume command into a tmux session.
- Claude resume syntax: `claude --resume {sessionId}` (documented in Claude Code docs).
- Does NOT start claude directly — sends the command into an existing tmux session.

---

## Layer 4: Domain — Restore

### P2-T07 — RestoreOrchestrator

| Field | Value |
|---|---|
| Risk | **HIGH** — most complex service in Phase 2; orchestrates the entire restore flow |
| Depends on | P2-T05, P2-T06, P2-T06b |
| Files | `src/domain/restore-orchestrator.ts`, `test/restore-orchestrator.test.ts` |
| Test | See detailed test plan below. |

**RestoreOrchestrator responsibilities:**

1. **Load snapshot** — parse SnapshotData from the snapshot
2. **Clear stale state** — for each node in the snapshot, clear any existing bindings and mark existing sessions as `superseded` (stale-binding repair)
3. **Compute restore plan** — topological sort of nodes by edges with deterministic tiebreaker (alphabetical by logical_id within same depth). Output is an ordered list of `RestorePlanEntry` objects.
4. **Execute restore** — for each node in plan order:
   a. Create tmux session via NodeLauncher
   b. Check `restore_policy`:
      - `relaunch_fresh` → skip resume, go to step d
      - `checkpoint_only` → skip resume, go to step d
      - `resume_if_possible` → continue to step c
   c. If node has `resume_type` + `resume_token`: select adapter by `resume_type` (claude_name/claude_id → Claude adapter, codex_id/codex_last → Codex adapter, none → skip). Attempt resume. If resume fails, fall through to step d.
   d. If checkpoint exists: write checkpoint to {cwd}/.rigged-checkpoint.md
5. **Report results** — per-node status

**Stale-binding repair (review fix #2):**
Before relaunching a node, the orchestrator must:
- Clear the node's existing binding (if any) so NodeLauncher doesn't see `already_bound`
- Mark the node's existing sessions as `superseded` so the reconciler doesn't re-process them

**Launch order policy (review fix #6):**
Not all edge kinds constrain launch order. Only edges with `kind` in the **launch-dependency set** create ordering constraints:
- `delegates_to` → source must launch before target (delegator before worker)
- `spawned_by` → target must launch before source (parent before child)

Other edge kinds (`can_observe`, `messaged`, etc.) are informational — they do NOT constrain launch order.

Topological sort uses only launch-dependency edges. Within the same topological depth, nodes are sorted alphabetically by `logical_id`. This is deterministic for any fixed graph.

The launch-dependency set is defined as a constant, not hardcoded into the sort. Adding a new ordering edge kind is a one-line change.

Test: for a graph with `orch -delegates_to-> worker-b, orch -delegates_to-> worker-a, worker-a -can_observe-> worker-b`, the plan order is `[orch, worker-a, worker-b]`. The `can_observe` edge does NOT force worker-a before worker-b — alphabetical tiebreaker does.

**Test plan (16 tests):**
1. Restore plan in topological order with alphabetical tiebreaker (exact order for fixed graph)
1b. `can_observe` edge does NOT constrain launch order (only `delegates_to` does)
2. Stale bindings cleared before relaunch (node was bound, restore clears it, relaunch succeeds)
3. Stale sessions marked superseded before relaunch
4. restore_policy=resume_if_possible + resume_type=claude_name → Claude resume adapter called
5. restore_policy=resume_if_possible + resume_type=codex_id → Codex resume adapter called
6. Resume succeeds → node marked as `resumed` in report
7. Resume fails → falls back to fresh launch with checkpoint file delivery
8. restore_policy=relaunch_fresh → resume NOT attempted even with valid token
9. restore_policy=checkpoint_only → resume NOT attempted, checkpoint file written
10. resume_type=none → resume NOT attempted regardless of policy
11. Fresh launch with checkpoint → checkpoint file written to {cwd}/.rigged-checkpoint.md
12. Fresh launch without checkpoint → launches cleanly, no file written
13. Node launch fails → marked as `failed` in report, remaining nodes still processed
14. Emits `restore.started` and `restore.completed` events
15. Pre-restore snapshot captured automatically (kind: 'pre_restore')

**RestoreResult type:**

```typescript
interface RestoreResult {
  snapshotId: string;
  preRestoreSnapshotId: string;
  nodes: RestoreNodeResult[];
}

interface RestoreNodeResult {
  nodeId: string;
  logicalId: string;
  status: 'resumed' | 'checkpoint_written' | 'fresh_no_checkpoint' | 'failed';
  error?: string;
}
```

---

## Layer 5: API Routes

### P2-T08 — Snapshot and restore endpoints

| Field | Value |
|---|---|
| Risk | **HIGH** — user-facing restore trigger |
| Depends on | P2-T05, P2-T07 |
| Files | `src/routes/snapshots.ts`, `src/server.ts` (mount), `test/snapshots-routes.test.ts` |
| Test | `POST /api/rigs/:rigId/snapshots` → creates snapshot, returns 201. `GET /api/rigs/:rigId/snapshots` → list snapshots. `GET /api/rigs/:rigId/snapshots/:id` → single snapshot with data. `POST /api/rigs/:rigId/restore/:snapshotId` → triggers restore, returns RestoreResult. Restore nonexistent snapshot → 404. |

Notes:
- Thin handlers. Restore completes before the response (synchronous for Phase 2).
- Mount at `/api/rigs/:rigId/snapshots` and `/api/rigs/:rigId/restore`.

---

## Deferred to Phase 2b

### Auto-snapshot triggers (was P2-T10)

Deferred per peer recommendation: premature coupling until manual snapshot/restore is proven stable. Will be added after Phase 2 core is validated.

Planned scope when added:
- EventBus subscriber for topology-change events → debounced snapshot
- Periodic timer (configurable interval) → auto-snapshot
- `kind: 'topology_change'` and `kind: 'auto'`

---

## Dependency Graph

```
P2-T01 ─── P2-T03 ─┐
                    ├── P2-T05 ─── P2-T07 ─── P2-T08
P2-T02 ─── P2-T04 ─┘       ↑
                            │
P2-T02b ────────────────────┘
                            ↑
P2-T06 ────────────────────┘
P2-T06b ───────────────────┘
```

## Recommended Execution Order

| Order | Task | Rationale |
|---|---|---|
| 1 | P2-T01, P2-T02, P2-T02b | **Parallel** — three independent schema migrations |
| 2 | P2-T03, P2-T04 | **Parallel** — snapshot repo and checkpoint store |
| 3 | P2-T05 | Snapshot capture (needs both repos + resume token) |
| 4 | P2-T06, P2-T06b | **Parallel** — Codex and Claude resume adapters |
| 5 | P2-T07 | RestoreOrchestrator (needs capture + resume adapters) |
| 6 | P2-T08 | API routes (needs orchestrator) |

## HIGH-Risk Tasks Requiring Architect Review

All tasks in Phase 2 are HIGH risk:

| Task | Why |
|---|---|
| P2-T01 | Snapshot schema shape determines what restore can access |
| P2-T02 | Checkpoint shape determines recovery quality |
| P2-T02b | Resume token is the primary input for session continuation |
| P2-T03 | Query patterns affect restore correctness |
| P2-T04 | Recovery quality depends on latest-checkpoint query contract |
| P2-T05 | Assembles the truth document — wrong capture = wrong restore |
| P2-T06 | Codex resume command shape must match actual CLI |
| P2-T06b | Claude resume command shape must match actual CLI |
| P2-T07 | Most complex service — topological ordering, stale repair, resume/fallback |
| P2-T08 | User-facing restore trigger |

## New Event Types

```typescript
| { type: "snapshot.created"; rigId: string; snapshotId: string; kind: string }
| { type: "restore.started"; rigId: string; snapshotId: string }
| { type: "restore.completed"; rigId: string; snapshotId: string; result: RestoreResult }
```

## New/Updated Domain Types

```typescript
// Session type updated (Phase 1 → Phase 2)
interface Session {
  id: string;
  nodeId: string;
  sessionName: string;
  status: string;       // now includes 'superseded'
  resumeType: string | null;    // NEW: claude_name | claude_id | codex_id | codex_last | none
  resumeToken: string | null;   // NEW: actual resume value (session name, ID, etc.)
  restorePolicy: string;        // NEW: resume_if_possible | relaunch_fresh | checkpoint_only
  lastSeenAt: string | null;
  createdAt: string;
}

interface Checkpoint {
  id: string;
  nodeId: string;
  summary: string;
  currentTask: string | null;
  nextStep: string | null;
  blockedOn: string | null;
  keyArtifacts: string[];
  confidence: string | null;
  createdAt: string;
}

interface SnapshotData {
  rig: Rig;
  nodes: NodeWithBinding[];
  edges: Edge[];
  sessions: Session[];
  checkpoints: Record<string, Checkpoint | null>;  // keyed by node id, not parallel array
}

interface Snapshot {
  id: string;
  rigId: string;
  kind: string;
  status: string;
  data: SnapshotData;
  createdAt: string;
}

interface RestorePlanEntry {
  node: NodeWithBinding;
  session: Session | null;          // carries resume_type, resume_token, restore_policy
  checkpoint: Checkpoint | null;
  strategy: 'attempt_resume' | 'checkpoint_written' | 'fresh';  // derived from policy + available data
  order: number;  // topological sort position
}

interface RestoreResult {
  snapshotId: string;
  preRestoreSnapshotId: string;
  nodes: RestoreNodeResult[];
}

interface RestoreNodeResult {
  nodeId: string;
  logicalId: string;
  status: 'resumed' | 'checkpoint_written' | 'fresh_no_checkpoint' | 'failed';
  error?: string;
}
```

## Definition of Done for Phase 2

- [ ] All 9 tasks complete with passing tests (P2-T01 through P2-T08, including T02b)
- [ ] `npm test` passes from root (both packages)
- [ ] Can capture a snapshot of a running rig via API
- [ ] Can restore a rig from a snapshot (tmux sessions recreated)
- [ ] Claude resume attempted when resume_token available, falls back to checkpoint
- [ ] Codex resume attempted when resume_token available, falls back to checkpoint
- [ ] Restore launches nodes in deterministic topological order (only delegates_to/spawned_by edges constrain order)
- [ ] Stale bindings/sessions cleared before relaunch
- [ ] Pre-restore snapshot captured automatically
- [ ] Resume token persisted and available for restore
- [ ] Zero Hono imports in `domain/` or `adapters/`
- [ ] Auto-snapshot deferred to Phase 2b (not in scope)
