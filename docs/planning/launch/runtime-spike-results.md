# Runtime Spike Results — Resume Tokens + Readiness Signals

Task: NS-T00
Date: 2026-03-31
Author: r01-dev1-impl@rigged-buildout
Versions tested: Claude Code 2.1.88, Codex CLI 0.117.0
Environment: macOS (Darwin 25.2.0), tmux 3.x

---

## Claude Code

### Resume Token

**Token type:** Session UUID (e.g., `88bac968-30d6-4cc2-99fa-2706daa38d9a`)

**Storage location:** `~/.claude/sessions/<pid>.json`

Each file contains:
```json
{
  "pid": 30793,
  "sessionId": "88bac968-30d6-4cc2-99fa-2706daa38d9a",
  "cwd": "/Users/mschwarz/code/rigged",
  "startedAt": 1774676083096,
  "kind": "interactive",
  "entrypoint": "cli",
  "name": "dev1-impl@rigged-buildout"
}
```

Session conversation data lives at `~/.claude/projects/<project-hash>/<sessionId>.jsonl`.

**Capture method:**
1. After launching `claude --name <name>`, read `~/.claude/sessions/` directory
2. Find the session file whose `name` matches the expected session name
3. Extract `sessionId` field — this is the resume token

**Alternative capture:** Read `~/.claude/sessions/` files sorted by `startedAt` descending. The most recent file with a matching `name` is the active session.

**Launch commands:**
- Fresh: `claude --name "{pod}-{member}@{rig}"`
- Resume: `claude --resume <sessionId> --name "{pod}-{member}@{rig}"`
- Continue most recent in CWD: `claude --continue`

**Resume semantics:**
- `--resume <sessionId>` loads the prior conversation history and continues
- If the session ID is invalid or expired, Claude starts fresh (no crash)
- `--fork-session` creates a new session ID when resuming (for parallel testing)

**Reliability:** HIGH. Session files are written synchronously on startup. The `sessionId` is a UUID generated at session creation time and persists across compactions. Session files survive machine reboots (they're on-disk JSON).

**Failure modes:**
- Session file deleted → fresh launch (no resume token available)
- Session JSONL too large / corrupted → Claude may start fresh silently
- PID reuse → old session file overwritten. Mitigate: capture token immediately after launch, before PID could be recycled.

### Readiness Signal

**Signal:** The `›` prompt character appears at the start of a line when Claude Code's TUI is ready for input.

**Observed pane content when ready:**
```
╭──────────────────────────────────────────╮
│ ✻ Welcome to Claude Code!                │
│                                          │
│   /help for help                         │
╰──────────────────────────────────────────╯
  Tips: ...

  cwd: /Users/mschwarz/code/rigged

›
```

**Regex:** `/^›/m` on captured pane content (multiline mode). The `›` (U+203A, single right-pointing angle quotation mark) appears when the TUI is idle and accepting input.

**Alternative signal:** After the welcome banner is displayed, the line containing `cwd:` appears. Regex: `/cwd:/m`. This is less reliable because it also appears during compaction output.

**Recommended approach:** Poll with `tmux capture-pane -p -S -5` every 2 seconds. Check for `›` at the start of any line. Timeout at 30 seconds.

**Boot timing:** Typical 2-4 seconds for fresh launch. Resume adds 1-2 seconds for conversation history load. Large conversations (100k+ tokens) may take 5-10 seconds.

**During boot (before ready):**
- Pane may show "Loading..." or Claude banner animation
- No `›` prompt until TUI is fully interactive
- Send-keys before ready → commands may be lost or buffered

---

## Codex

### Resume Token

**Token type:** Session UUID (e.g., `019d19c6-ed27-7e53-8e5b-0666f4eeb2e5`)

**Storage location:** `~/.codex/session_index.jsonl`

Each line contains:
```json
{
  "id": "019d19c6-ed27-7e53-8e5b-0666f4eeb2e5",
  "thread_name": "dev1-qa@rigged-buildout",
  "updated_at": "2026-03-28T18:11:09.417365Z"
}
```

Session conversation data lives at `~/.codex/sessions/<year>/<month>/<day>/<filename>.jsonl`.

**Capture method — tied to the startup sequence (NS-T05):**

The critical insight: Codex does not write to `session_index.jsonl` until the first conversation exchange. The `›` prompt signals TUI readiness, but NO token exists yet. The token becomes available only after the startup orchestrator delivers interactive content (send_text files) through the TUI, which constitutes the first exchange.

Concrete sequence:
1. Record line count of `~/.codex/session_index.jsonl` before launch
2. Launch `codex` in tmux via send-keys
3. Wait for readiness (`›` prompt via capture-pane)
4. The startup orchestrator delivers send_text startup files (step f in NS-T05). This IS the first exchange.
5. Wait briefly (1-2s) for Codex to process and write to `session_index.jsonl`
6. Read new lines appended since step 1
7. If exactly one new entry, extract `id` — this is the resume token
8. If zero new entries after timeout (5s), token capture failed — return `HarnessLaunchResult` with `resumeToken: undefined`. The node launches successfully but resume is not yet possible.
9. If multiple new entries, token capture is ambiguous — return `resumeToken: undefined`. Never guess by picking the most recent. Binding the wrong token to a node is worse than having no token.

**For nodes with NO send_text startup content:** There is no first exchange, so no token can be captured at launch time. The `HarnessLaunchResult` carries `resumeToken: undefined`. Resume for this node becomes possible only after the first real interaction. This is an honest limitation — the node is RUNNING but not yet resumable.

**Critical limitation: `thread_name` is NOT controllable.** Codex has no `--name` flag. The `thread_name` is set internally by Codex based on conversation content, not by the launcher. Token capture must use **temporal correlation** (line count diff), not name matching.

**Open question for NS-T04:** If multiple Codex instances launch simultaneously, temporal correlation may be ambiguous. Mitigated by the instantiator's sequential launch order (topological sort). If ambiguity still occurs, the adapter returns `resumeToken: undefined` rather than guessing.

**Launch commands:**
- Fresh: `codex` (no `--name` flag)
- Resume: `codex resume <sessionId>`
- Resume most recent: `codex resume --last`

**Resume semantics:**
- `codex resume <sessionId>` loads prior conversation and continues
- Invalid session ID → error, not silent fresh launch
- `codex resume` without ID opens an interactive picker

**Reliability:** MEDIUM. The session index is written during and after conversations, not at launch time. The token is not available until the first exchange completes. For initial capture, monitor the session index file for a new entry after launch.

**Failure modes:**
- Session index file missing → no resume possible
- Session JSONL file missing → resume fails with error
- Session index stale (codex crashed before writing) → token not captured

### Readiness Signal

**Signal:** The `›` prompt character appears when Codex TUI is ready for input.

**Observed pane content when ready:**
```
  gpt-5.4 xhigh fast · 74% left · ~/code/rigged

›
```

Or when idle after completing work:
```
  4 background terminals running · /ps to view · /stop to close

› Use /skills to list available skills

  gpt-5.4 xhigh fast · 48% left · ~/code/rigged
```

**Regex:** `/^›/m` on captured pane content — same as Claude Code. Both TUIs use the same `›` prompt character.

**Alternative signal:** The status line at the bottom containing the model name and context percentage (e.g., `gpt-5.4 xhigh fast · 74% left`). Regex: `/\d+% left/m`.

**Recommended approach:** Same as Claude Code: poll with `tmux capture-pane -p -S -5` every 2 seconds. Check for `›` at start of line. Timeout at 30 seconds.

**Boot timing:** Typical 3-6 seconds. Resume adds 1-3 seconds. Context-heavy sessions may take 10+ seconds.

---

## Summary for NS-T04 (Adapter Implementation)

### Resume Token Capture

| Runtime | Token Source | Capture Timing | Reliability |
|---|---|---|---|
| Claude Code | `~/.claude/sessions/<pid>.json` → `sessionId` | Immediately after launch (file written on startup) | HIGH |
| Codex | `~/.codex/session_index.jsonl` → `id` | After startup content delivery (temporal correlation) | MEDIUM — requires send_text content |

### Resume Commands

| Runtime | Fresh Launch | Resume |
|---|---|---|
| Claude Code | `claude --name <name>` | `claude --resume <sessionId> --name <name>` |
| Codex | `codex` | `codex resume <sessionId>` |

### Readiness Detection

| Runtime | Primary Regex | Fallback | Typical Boot | Timeout |
|---|---|---|---|---|
| Claude Code | `/^›/m` | `/cwd:/m` | 2-4s (fresh), 3-6s (resume) | 30s |
| Codex | `/^›/m` | `/\d+% left/m` | 3-6s (fresh), 4-9s (resume) | 30s |

Both runtimes use the same `›` prompt character. The adapter's `checkReady` can use a single regex for both.

### Adapter Design Implications

1. **Token capture is async and name-blind for Codex.** The Claude adapter can read the token immediately after launch using `--name` matching. The Codex adapter must use temporal correlation: snapshot `session_index.jsonl` before launch, then after startup content delivery (the first exchange), read new entries. Codex has no `--name` flag, so the adapter cannot match by thread_name. For nodes with no send_text content, `resumeToken` will be `undefined` at launch time — the node is running but not yet resumable.

2. **Resume failure is FAILED, never auto-fresh.** If the resume token is missing, the session file is corrupted, or the resume command fails, the adapter must mark the node as `startup_failed` with a clear error message. The system must NOT silently launch fresh instead. This is the core product rule (product-context.md: "if resume fails, say so loudly. Don't quietly launch fresh."). The node status must be visibly FAILED in both CLI and dashboard. The human/orchestrator decides what to do — retry, launch fresh explicitly, or investigate.

3. **Readiness polling should be unified.** Both adapters can share a `waitForReady` utility that polls `tmux capture-pane` for the `›` pattern with exponential backoff (2s → 4s → 8s → 16s) and a 30s timeout.

4. **Terminal adapter needs no readiness check.** A terminal node's session is "ready" immediately after `tmux new-session -d` — the shell is interactive by default. Terminal startup commands (`npm run dev`) are fire-and-forget.

5. **Token storage in DB.** After capturing the resume token, persist it via `SessionRegistry.updateResumeToken(sessionId, type, token)` (new method needed in NS-T04). The restore orchestrator reads it when constructing the resume command.

### Edge Cases

- **Multiple Claude instances in same CWD:** Session files are keyed by PID, so no collision. Each instance gets a unique `sessionId`.
- **Codex parallel launch ambiguity:** If multiple Codex sessions start during the capture window (from parallel launches or unrelated local Codex activity), temporal correlation is ambiguous. The adapter MUST return `resumeToken: undefined` — never guess. Binding the wrong token to a node is worse than having no token. Mitigation: the instantiator's sequential launch order (topological sort) minimizes this risk.
- **Machine reboot before token capture:** Session file exists but the PID is stale. The `sessionId` is still valid for resume. No data loss.
- **Very long conversations (500k+ tokens):** Resume may be slow (10-20s). The 30s timeout should accommodate this. If it doesn't, the adapter marks the node as `startup_failed` and the user decides.
