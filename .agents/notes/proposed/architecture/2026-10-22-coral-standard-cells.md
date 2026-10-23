# Agent Note: Native, ACP, and A2A as Coral standard plugins

Status: proposed

## Problem

The three v0.1 adapter notes (`coral-carrier-inproc`, `coral-carrier-acp`, `coral-carrier-a2a-client`) each repeat a slightly different carrier contract: inproc takes `grant: ScopeGrant` and returns `Promise<Receipt>` from `send`; ACP and A2A drop `grant` and return `Promise<void>`. None declares the capability object it discovers, the call that discovers it, or the point at which session-level capability appears. Those omissions hide the three protocols' real differences: ACP capability is two-stage (`initialize`, then `session/new`); A2A has no session, only tasks; native has no wire at all, only `ctx.subagents` and `SubagentCapabilities`.

## Proposal

Ship one package per standard, each exporting `Standard` from [the standard-plane note](2026-10-22-coral-standard-plane.md): `packages/coral/standard-native`, `packages/coral/standard-acp`, and `packages/coral/standard-a2a`. No standard imports another, and none imports `coral.engine`.

### Native — `standard-native`

Native is a standard whose transport is a direct call. Its authority is DSH's provider registry, not a wire.

- Raw facet: a projection of `SubagentCapabilities` (`agentOptions`, `outputSchema`, `depthLimit`, `toolFilter`, `persona`, `stepBudget`, `childSandboxMode`) plus the registered provider names.
- `detect(endpoint)`: the endpoint's flavor is `inproc`, and `ctx.subagents` has the named provider; returns the facet. A missing provider returns `null`, not a fault.
- `connect`: wraps `ctx.subagents.start`, `startContinuable`, and `sendMessage`.
- Level 0: the provider is registered. Level 1: `start()` returns a `SubagentAddress`; the session handle is `{ kind: 'native', address }`.
- Discovery: `structuredOutput` from `outputSchema`; `streaming` true because DSH emits mid-turn updates; `resumable` true only when a continuation is available; `maxAttachBytes` null; `media` from the child's accepted content blocks; `protocolClass: 'async'`.
- Normalization: a provider-accepted spawn becomes a spawn ack; the `agent-message` relay becomes a message; a settlement notice becomes a settle; a tool boundary becomes mcp; an artifact append becomes an artifact.
- Cold resume rides DSH continuation; a missing continuation means `resumable: false` for that endpoint.

### ACP — `standard-acp`

- Raw facet: the `initialize` response's `agentCapabilities` — `protocolVersion`, `loadSession`, `promptCapabilities { image, audio, embeddedContext }`, and `authMethods`.
- `detect`: spawn or attach the configured executable, send `initialize`, and return the capability object; a protocol error throws `PROTOCOL_VIOLATION`.
- `connect`: a typed client over the ACP library; `session/new`, `session/prompt`, `session/cancel`, and `session/load` are gated by `loadSession`.
- Level 0: `initialize`. Level 1: the `session/new` response — `modes` and `availableModes`, `models`, and `slashCommands`.
- Discovery: `resumable` equals `loadSession`; `streaming` true; `structuredOutput` false because ACP has no output schema; `maxAttachBytes` null; `media` from `promptCapabilities`; `protocolClass: 'async'`.
- Normalization: `session/update` `agent_message_chunk` becomes message chunks on one `corrId`; `tool_call*` becomes an artifact; plans become a data-package; stopReason becomes a settle; `fs/*`, `terminal/*`, and `session/request_permission` stay host-internal and never become envelopes.
- Cold resume uses `session/load` when advertised; otherwise the session is gone and a new session is a new level-1.

### A2A — `standard-a2a`

- Raw facet: the `AgentCard` — `capabilities { streaming, pushNotifications, stateTransitionHistory, extensions }`, `supportedInterfaces`, `skills`, `securitySchemes`, `defaultInputModes`, `defaultOutputModes`, and `protocolVersion`.
- `detect`: `GET /.well-known/agent-card.json`, verify the card signature through `reef.trust`, and return the card. A failed fetch or bad signature throws `POLICY_REFUSED`; a valid response without the expected card shape throws `PROTOCOL_VIOLATION`.
- `connect`: a typed client over the A2A SDK; `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`, and the push-config calls are gated by the facet.
- Level 0: the card. Level 1: the Task returned by `message/send`; the session handle is `{ kind: 'a2a', taskId }`. A2A has no session object, so the task is the unit the bake keys on.
- Discovery: `streaming` equals `capabilities.streaming`; `resumable` false because a task can be read but not resumed as a conversation; `structuredOutput` reflects whether the card declares a schema-bearing output mode; `maxAttachBytes` from the card's declared limits when present; `media` from the default input and output modes; `protocolClass` is `'async'` when streaming and `'sync'` otherwise.
- Normalization: a Task accepted becomes a spawn ack; status updates become a data-package; artifact updates become an artifact; terminal `completed`, `failed`, `canceled`, and `rejected` become a settle with a reason; `input-required` becomes a settle `{ reason: 'blocked' }`.
- Cold resume is false; a new task is a new level-1.

### Discovery projection

| Raw field | Discovery field | Outbound function it gates |
|---|---|---|
| A2A `capabilities.streaming` | `streaming` | `message/stream` |
| A2A `capabilities.pushNotifications` | raw only | push-config calls |
| A2A `capabilities.stateTransitionHistory` | raw only | `tasks/get` history |
| A2A `supportedInterfaces` | `media` and flavor selection | binding choice |
| A2A `skills[].inputModes/outputModes` | `media` | part validation |
| A2A `securitySchemes` | `authSchemes` | outbound auth |
| ACP `loadSession` | `resumable` | `session/load` |
| ACP `promptCapabilities.image/audio/embeddedContext` | `media` | prompt content blocks |
| ACP `session/new` `modes` and `models` | session facet only | `session/set_mode`, model selection |
| Native `SubagentCapabilities.outputSchema` | `structuredOutput` | schema-bearing start |
| Native provider list | raw only | provider selection |

### Rules

Spec fields keep their names. A standard's raw facet extends the spec or SDK type and never retypes it. `discovery()` is total and conservative: a field with no honest mapping is `false` or `null`. `connect()` never widens: a method the facet forbids is absent or rejects with `CAPABILITY_UNSUPPORTED`. A detection call is bounded and cancellable and does not outlive the handshake timeout. A standard mounts its own card and protocol scope through `mountHost(server)` and never opens a listener.

## Alternatives considered

**One universal carrier client.** This is the v0.2 adapter shape; it hides exactly the differences above. It loses because ACP's two-stage capability, A2A's task-instead-of-session, and native's provider registry cannot be expressed without special cases inside a generic client.

**Use the upstream SDK clients directly without wrapping.** Fewer types, but the engine needs envelopes, typed faults, trust narrowing, and a uniform `detect`; every consumer would otherwise repeat that work. The standard wraps the SDK and leaves its types visible.

**Rename spec fields into the shared vocabulary.** A single `streaming` across protocols looks tidy but lies: ACP's chunked updates are not A2A streaming, and ACP's `promptModes` has no A2A analogue. Keeping raw fields and normalizing only the discovery projection preserves meaning.

**Treat an A2A task as a session.** The task is the closest level-1 handle, but it is not resumable and has no mode or model surface. Calling it a session would give consumers a false `resumable` and a false rebind story.

**Implement native as a wire protocol.** Native has no serialization; its authority is `ctx.subagents`. Pretending it has a wire adds a codec and loses DSH's own capability checks.

## Acceptance criteria

- Each standard passes one shared contract suite (detect, bind, connect, adapt, send, observe, dispose) against a fake peer.
- Each raw facet type is assignable from its source type in a compile-time test: the A2A card, ACP `agentCapabilities`, and DSH `SubagentCapabilities`.
- `detect()` returns `null` for a peer that speaks a different standard and throws a typed fault for a malformed response from a peer that speaks this one.
- For every `false` discovery field, the corresponding outbound method is absent or rejects with `CAPABILITY_UNSUPPORTED`.
- The normalization table is covered by fixture tests, including `input-required` becoming a settle with reason `blocked` and `fs/*` never becoming an envelope.
- Level-1 triggers are tested per standard: native spawn, ACP `session/new`, and A2A `message/send` returning a Task.
- No standard package imports `coral.engine` or another standard package.

## Risks

- **Spec drift.** A2A is at 1.0 and ACP's v2 draft renames prompt-turn to prompt-lifecycle and adds `session/elicit`; a rename becomes a compile error in the raw facet, which is intended but recurring.
- **ACP detection cost.** Detection spawns a process and performs `initialize`; handshakes must bound concurrency and reuse a live session where possible.
- **A2A trust dependency.** Card verification requires `reef.trust`; a coral profile without trust cannot bind an A2A row. That is intentional, but it makes trust a hard prerequisite for the net standard.
- **Native coupling.** The native facet tracks `SubagentCapabilities`; a DSH capability change forces an adapter change in the same PR.
- **Task as level-1.** The bake keys on a task id that may terminate before the agent is done with the peer; the tool must re-open a task rather than assume the handle survives.
