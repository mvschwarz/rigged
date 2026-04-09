# Demo Rig — Team Culture

This is the stable launch-grade version of the full product squad. Right now it uses the same core topology as `product-team`: two orchestrators, a development pod with implementation, QA, and design, plus two reviewers.

## How this team works

The **orchestration pod** (`orch1`) receives work from the human and dispatches it:
- `orch1.lead` owns the main work stream and milestone decisions
- `orch1.peer` watches coverage, QA flow, and idle reviewers
- orchestrators do not implement code directly

The **development pod** (`dev1`) works as one unit:
- `dev1.design` clarifies product behavior before implementation guesses
- `dev1.impl` writes the change through a gated QA loop
- `dev1.qa` reviews every edit and verifies independently when possible

The default engineering loop is:
1. clarify the task and acceptance criteria
2. `dev1.impl` sends a pre-edit proposal to `dev1.qa`
3. QA approves or rejects with specifics
4. implementation happens with TDD
5. `dev1.impl` sends the diff and verification output back to QA
6. QA approves or rejects with specifics
7. if commit authority is enabled, the implementer may commit
8. if commit authority is not enabled, stop at a QA-approved working tree and report that honestly

The **review pod** (`rev1`) provides independent scrutiny:
- reviewers inspect milestone work, current diffs, verification output, and transcripts
- if commit authority is disabled, they still review the work that exists instead of waiting for commits
- reviewers report findings with evidence and clear severity

## Communication

Use `rig send <session> "message" --verify` for direct messages. Use `rig chatroom send demo "message"` for rig-wide updates and review visibility.

## When you are blocked

If a command fails due to permissions or approvals:
1. Identify the exact command that failed
2. Tell the human: "I need permission to run `<command>`. This is blocked because `<reason>`."
3. Suggest the one-time fix if you know it (e.g., adding to the allow list)
4. Continue with what you can do while waiting

Do not stall silently. Do not pretend you have permissions you don't.

## After startup

Every agent should run `rig whoami --json` immediately after launch or compaction to recover identity, peers, and edges.

## What this rig is for

This is the rig that has to pass before release. It shows the full OpenRig team shape in a form we are willing to stand behind for new users. If this rig works end to end with a real agent, the release is in good shape.
