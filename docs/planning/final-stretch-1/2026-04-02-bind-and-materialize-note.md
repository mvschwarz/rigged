# Bind And Materialize Note

## Goal

Close the minimal agent-facing gaps required to:

- capture a live tmux-backed working set into a managed rig
- add pods or nodes to an existing rig without launching fresh sessions
- retroactively attach discovered live sessions onto logical nodes that already exist in a rig

This is intentionally not a human wizard or topology builder. The authoring surface stays the spec plus direct CLI/API commands. Agents configure. Humans observe.

## The Two Primitives

### 1. Materialize

Materialize means:

- create pods
- create nodes
- create edges
- emit rig-scoped events so the graph refreshes
- do **not** launch sessions

This must work for:

- a new rig created from a pod-aware RigSpec
- an existing rig targeted by a pod-aware spec fragment or partial spec

The agent writes the structure. Rigged persists the structure. Session launch/bind is a separate concern.

### 2. Bind

Bind means:

- take one discovered live session
- attach it to an existing logical node in a rig
- persist binding + claimed session metadata
- mark the discovery row claimed
- emit a rig-scoped event so the graph refreshes

This is different from the current `claim` behavior, which creates a new node from a discovered session. `bind` is the more truthful primitive for managed topology growth and retrofit adoption.

## Recommended Contract

### CLI

Add:

- `rigged bind <discoveredId> --rig <rigId> --node <logicalId>`
- `rigged import <path> --materialize-only [--target-rig <rigId>] [--rig-root <root>]`

Keep existing `rigged claim` behavior for now so current code paths do not break during the transition. The long-term direction is for `claim` to become sugar over `create node + bind`, not the other way around.

### HTTP

Add:

- `POST /api/discovery/:id/bind`
- `POST /api/rigs/import/materialize`

`/api/rigs/import/materialize` should accept the same YAML body as pod-aware import and optionally a target rig identifier for additive materialization into an existing rig.

## Scope Rules

### What this implementation should do

- pod-aware specs only for materialize-only
- create new rig structure without launch
- add new pods/nodes/edges into an existing rig without launch
- bind discovered tmux sessions to existing logical nodes
- update the graph automatically through existing rig-scoped SSE invalidation

### What this implementation should not do

- no wizard
- no topology drag-and-drop editing
- no automatic inference of pods or edges from discovery
- no non-tmux machine-wide discovery expansion in this pass

## Error Model

Stay honest and agent-facing:

- duplicate node logical ID in target rig -> fail loudly with the conflicting logical ID
- target node already bound -> fail loudly
- materialize fragment references nonexistent existing node in cross-pod edge -> fail loudly
- malformed or non-pod-aware spec passed to materialize-only -> fail loudly

No silent fallback to fresh launch. No hidden auto-merge behavior.

## Why this is enough

With these two primitives, an agent can already do the rest:

1. inspect live sessions with discovery
2. author or refine the pod-aware spec
3. materialize the target topology
4. bind each discovered live session to the intended node

That covers both:

- “turn this current live topology into a rig”
- “add a research pod live to an existing rig”

without building human-centric capture UX.
