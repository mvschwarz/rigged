---
name: openrig-user
description: Use when operating OpenRig with the `rig` CLI and you need the shipped command surface for identity, inventory, communication, lifecycle, specs, recovery, or agent-facing JSON output.
---

# OpenRig User

Use this skill when you are working inside an OpenRig-managed topology or operating OpenRig as an agent.
Treat `rig ... --help` and current code as ground truth if anything here ever conflicts with older notes.

## Core Loop

Most OpenRig work reduces to:
- recover identity: `rig whoami --json`
- inspect state: `rig ps --nodes --json`
- read context: `rig transcript ...`, `rig ask ...`, `rig chatroom history ...`
- act: `rig send`, `rig capture`, `rig broadcast`, lifecycle commands

## Identity

Start here after launch, compaction, or confusion:

```bash
rig whoami --json
```

This returns your rig, logical ID, pod/member, session name, runtime, peers, transcript info, and `contextUsage` when available.

Useful targeting flags:

```bash
rig whoami --session <name>
rig whoami --node-id <id>
```

## Inventory and Health

```bash
rig ps
rig ps --json
rig ps --nodes
rig ps --nodes --json
rig status
rig daemon status
rig doctor
```

Use `rig ps --nodes --json` as the main machine-readable operator surface.

## Communication

### Transcript

```bash
rig transcript <session> --tail 100
rig transcript <session> --grep "pattern"
rig transcript <session> --json
```

### Send to one peer

```bash
rig send <session> "message"
rig send <session> "message" --verify
rig send <session> "message" --json
```

### Capture terminal output

```bash
rig capture <session>
rig capture <session> --lines 50
rig capture --rig <name>
rig capture --pod <name> --rig <name>
rig capture --rig <name> --json
```

### Broadcast

```bash
rig broadcast --rig <name> "message"
rig broadcast --pod <name> "message"
rig broadcast "message"
rig broadcast --rig <name> "message" --json
```

Aggregate transport commands report `transport_unavailable` honestly for nodes such as `external_cli` that cannot receive inbound tmux transport.

### Chatroom

```bash
rig chatroom send <rig> <message> [--sender <name>]
rig chatroom history <rig> [--topic <name>] [--after <id>] [--since <ts>] [--sender <name>] [--limit <n>] [--json]
rig chatroom wait <rig> [--after <id>] [--topic <name>] [--sender <name>] [--timeout <seconds>] [--json]
rig chatroom clear <rig>
rig chatroom topic <rig> <topic-name> [--body <text>] [--sender <name>]
rig chatroom watch <rig> [--tmux]
```

Roundtable loop:
1. inspect room: `rig chatroom history my-rig --limit 5`
2. save if needed: `rig chatroom history my-rig --json > /tmp/old-room.json`
3. clear if needed: `rig chatroom clear my-rig`
4. set topic: `rig chatroom topic my-rig "ROUND START"`
5. post: `rig chatroom send my-rig "position..." --sender <session>`
6. monitor: `rig chatroom wait my-rig --timeout 120`
7. close: `rig chatroom topic my-rig "ROUND CLOSED"`

## `rig ask`

```bash
rig ask <rig> "question"
rig ask <rig> "question" --json
```

`rig ask` is an evidence/context command. It uses structured rig state plus transcript/chat evidence. It is not a hidden second-LLM call.

## Lifecycle

### Launch or restore a rig

```bash
rig up <source>
rig up <source> --plan
rig up <source> --yes
rig up <source> --cwd <path>
rig up <source> --json
```

`<source>` can be:
- a rig spec path
- a `.rigbundle` path
- a bare name

Current behavior notes:
- `--cwd <path>` is the launch-time cwd override for all members in the rig
- `--target <root>` is only for bundle/package installation; it does not change agent cwd
- `local:` `agent_ref` values resolve relative to the rig spec directory, not your shell cwd
- bare names are ambiguous if they match both a library spec and an existing rig name; OpenRig fails loudly instead of guessing

Legacy bootstrap surface still ships too:

```bash
rig bootstrap <spec> [--plan] [--yes] [--cwd <path>] [--json]
rig requirements <spec> [--json]
```

### Tear a rig down

```bash
rig down <rigId>
rig down <rigId> --snapshot
rig down <rigId> --delete
rig down <rigId> --force
rig down <rigId> --json
```

`rig down` now cleans only OpenRig-managed blocks from `CLAUDE.md` and `AGENTS.md`, preserving user and third-party content.

### Release claimed/adopted rigs without killing live sessions

```bash
rig release <rigId>
rig release <rigId> --delete
rig release <rigId> --json
```

Use `rig release` for adopted/claimed-session rigs when the external tmux sessions should stay alive.
If a rig contains OpenRig-launched nodes, `rig release` fails loudly with `contains_launched_nodes`.

### Snapshot and restore

```bash
rig snapshot <rigId>
rig snapshot list <rigId>
rig restore <snapshotId> --rig <rigId>
```

## Discovery, Binding, and Attach

### Discover unmanaged tmux sessions

```bash
rig discover
rig discover --json
rig discover --draft
```

### Bind a discovered session

```bash
rig bind <discoveredId> --rig <rigId> --node <logicalId>
rig bind <discoveredId> --rig <rigId> --pod <namespace> --member <name>
```

There is no shipped top-level `rig claim` command. The adoption surface is `discover`, `bind`, `adopt`, and `unclaim`.

### Self-attach the current shell or agent

```bash
rig attach --self --rig <rigId> --node <logicalId>
rig attach --self --rig <rigId> --node <logicalId> --print-env
rig attach --self --rig <rigId> --pod <namespace> --member <name> --runtime <runtime>
```

Proven behavior:
- inside tmux: attaches as a normal tmux-backed node
- outside tmux: attaches as `external_cli`
- `--print-env` prints `OPENRIG_NODE_ID` and `OPENRIG_SESSION_NAME`

## Adopt Existing Sessions

```bash
rig adopt <path> --bindings-file <bindings.yaml>
rig adopt <path> --bind <logicalId=liveSession>
rig adopt <path> --bindings-file <bindings.yaml> --target-rig <rigId>
```

Spec + bindings is the proven recovery pair for adopted rigs.

Proven recovery loop for still-alive sessions:

```bash
rig release <rigId> --delete
rig discover --json
rig adopt <spec.yaml> --bindings-file <bindings.yaml>
```

Mixed-origin rigs are allowed:
- adopted nodes and OpenRig-launched nodes can coexist
- but whole-rig `rig release` only works for claimed/adopted-only rigs

## Specs and Library

```bash
rig specs ls [--kind <kind>] [--json]
rig specs show <name-or-id> [--json]
rig specs preview <name-or-id> [--json]
rig specs add <path> [--json]
rig specs sync [--json]
```

```bash
rig export <rigId> -o rig.yaml
rig import <path> [--instantiate] [--materialize-only] [--preflight] [--target-rig <rigId>] [--rig-root <root>]
rig bundle create <spec> -o out.rigbundle
rig bundle inspect <bundle>
rig bundle install <bundle> [--plan] [--yes] [--target <root>] [--json]
```

## After-Compaction Recovery Checklist

1. `rig whoami --json`
2. `rig transcript <your-session> --tail 100`
3. `rig ps --nodes --json`
4. `rig chatroom history <rig> --limit 50`

## Commands That Do Not Exist

Do not assume these exist unless `rig --help` starts listing them:
- `rig claim`
- `rig env`
- `rig blame`
- `rig replay`
