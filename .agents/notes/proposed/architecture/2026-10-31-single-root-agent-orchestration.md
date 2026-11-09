# Agent Note: Single-root agent orchestration

Status: proposed

## Problem

DSH can run an agent loop in-process, and `ctx.agents.create()` can create more than one, but the only first-class way for one agent to hand work to another is the subagent provider surface. That surface is parent-owned and one-shot: a parent agent calls a model-visible tool, a child process or child scope receives a task, and the parent receives a result. It is not a harness-level orchestration model, and it does not give a browser a projection of two live agent sessions handing work back and forth.

The Web client can already show one conversation, and Turbo can tile arbitrary sessions, but neither exposes the relationship that matters during orchestration: which session is the lead, which sessions are direct peers or children, what work is in flight, and where a handoff crossed. The missing artifact is a projection, not another agent runtime.

## Proposal

Run both agent loops under one real Cordis root and one composition:

```text
Root (one process, one composition)
├── sessions service          global, keyed by session id
├── orchestrator service      root-level control
├── host-a record             logical host, inproc endpoint
├── host-b record             logical host, inproc endpoint
├── agent A scope             own session
└── agent B scope             own session
```

The root is not duplicated. The two agents are child scopes created through `ctx.agents.create()`. The host records are logical rows in an orchestration projection; they do not imply separate processes. The sessions service stays global, and session identity keeps the conversations separate.

### Orchestrator service

The harness owns a root-level service rather than a model-facing subagent provider:

```ts
type AgentId = SessionId

interface OrchestrationPeer {
  readonly id: AgentId
  readonly session: SessionId
  readonly label: string
  readonly role: 'lead' | 'peer'
}

interface Orchestrator {
  spawn(peer: OrchestrationPeer): Promise<void>
  peers(): readonly OrchestrationPeer[]
  prompt(id: AgentId, content: ContentBlock[]): Promise<void>
  handoff(from: AgentId, to: AgentId, content: ContentBlock[]): Promise<void>
  close(id: AgentId): Promise<void>
}
```

`spawn` creates an agent with `ctx.agents.create()`. `prompt` appends a user message to that agent and drives its loop. `handoff` records the cross-session edge and then prompts the target; the target's response is visible in its own session, not folded into the sender's conversation. This is the difference from a subagent tool result: both conversations remain first-class and independently observable.

### Handoffs and multiple sessions

Each peer owns one home session. A handoff may target that home session or a new direct-child session created through the existing subagent continuation seam. The first implementation uses the home session for both loops and records each handoff as a projection edge. A later continuation uses `startContinuable` when a peer needs a fresh workspace while retaining its identity.

No second registry is introduced. A and B are ordinary sessions in `ctx.sessions`; the orchestrator indexes them.

### Transport

In-process agents do not need stdio. The host-plane vocabulary still applies:

```text
Transport.inproc → one queue-pair Connection per endpoint
ACP standard     → newline-delimited JSON-RPC frames over that Connection
```

That transport is useful when the orchestration needs protocol parity with a future out-of-process deployment, but the first implementation may call `ctx.agents` directly. A process boundary is added only when isolation or a foreign ACP agent requires it.

### UI projection

Add a new `ui-orchestration` layout mode. It registers one choice card and one `layout.mode.entry` in `ui-layout-mode`, exactly like Turbo. The mode renders:

- the shared sidebar;
- two pinned sessions side by side, each through the existing `main.conversation` renderer and `PinnedSessionProvider`;
- a handoff rail listing the selected session's direct subagent children, their mode and activity, and the parent/child relation;
- a compact session header for each pane with title, root/child identity, and running state.

The mode reads `useSessions` state and `subagentsByParent`; it does not read a private orchestration store. It is a projection of session state that already exists.

## Alternatives considered

**Spawn an ACP subprocess per peer.** This gives process isolation and a real wire, but it discards the shared root, duplicates composition and credentials, and makes a two-peer handoff a process-management problem. It is the right fallback when a peer is foreign or untrusted, not the default for two loops the harness owns.

**Use `subagent-spawn-in-process`.** This already creates a child loop in-process, but it is a provider behind the model-facing subagent tool. The harness cannot schedule the peer directly, the parent receives only a result, and intermediate work stays outside the parent conversation. The orchestrator service needs both sessions visible.

**Use the experimental Agent Teams lead-star.** Teams already has roster, task, and mailbox primitives, but its spawn and interrupt paths are lead-only and its UI is a single-session panel. A two-peer orchestration mode would have to invert or duplicate the lead-star model. Reuse its continuation ideas later; do not make it the first peer layout.

**Create a fake orchestration root.** A child context is not a root, and a fake root would not share the real session service or composition. The real root already is the control plane. Split roots only when isolation is the goal.

## Acceptance criteria

- One harness process and one Cordis root host both agent scopes.
- Each agent owns a distinct session id and conversation; neither shares a session.
- The orchestrator can prompt either agent without a model-facing subagent tool call.
- A handoff from A to B leaves A's and B's sessions independently readable.
- A second handoff can cross in the other direction.
- The `ui-orchestration` mode shows both pinned sessions and the direct handoff relation.
- No subprocess, HTTP server, or SSE stream is required for the first implementation.

## Risks

- Shared root means shared credentials, event loop, and most services; a crash or CPU-bound turn affects both loops.
- Session visibility is broad. The UI must not imply isolation it does not have.
- The existing subagent seam authorizes only parent-child adjacency; arbitrary peer messaging is not supported without the orchestrator service.
- The browser keeps live event windows for a bounded recent set of sessions; a mode that pins two sessions must retain them explicitly.
- The host-plane records in the UI are projections, not runtime authority; the note must not turn them into a second registry.

The first slice ships the `ui-orchestration` projection. The orchestrator service and handoff runner follow behind the same session and projection contracts.
