# Agent Note: Turn shape is session-scoped logged state

Status: implemented

## Problem

The conversation-mode turn shape (`narrate` / `quiet` / `tools`) was armed in the Host user-settings document under the `ui-quiet` namespace — one global value for every session the deployment runs. A selector pick in one session silently re-shaped every other session's next turn, and two browser tabs could not run different shapes concurrently. The per-`(session, turn)` snapshot in the plugin only decided *when* a value applied; the value itself was deployment-wide.

## Decision

Turn shape moves from user settings to **logged per-session state**, following [plan-specific collaboration state](../simplification/2026-07-22-plan-specific-collaboration-state.md) — the same pattern [`plan/mode`](../../../packages/plan/plan-mode/src/index.ts) and [`step-pace`](../../../packages/api/session-controller/src/step-pace.ts) already ride:

- One whole-value, log-only session event **`turn-shape/mode`** (`{ shape }`) arms the shape; the last event wins. Resume and fork restore it through the fold; no `SESSION_FORMAT_VERSION` bump (event-type additions ride the `SessionEventMap` mechanism).
- A **session projection `turnShape`** folds the log (`turnShapeProjectionDefinition`, registered by the conversation-mode plugin when `ctx.sessionProjections` is composed) and serves the shape to the host pre-step and to clients through the generic projection read/change surfaces.
- The plugin's step-1 pre-step reads the projection and keeps its per-`(session, turn)` snapshot mint, so a selection made mid-turn applies from the next turn exactly, and same-step retries remint nothing.
- Two writers append the event: the `session.setTurnShape` Remote (`dsh-api-session-controller`, mirroring `setStepPace`) and a `/turn-shape <narrate|quiet|tools>` command; the composer pill reads `useProjection('turnShape')` and submits through the Remote.
- The `ui-quiet` settings namespace, its schema, and the legacy `mode`-field migration are deleted. Documents written with them are simply no longer read anywhere; the shape resets to `narrate` for sessions without a logged selection.

## Alternatives considered

- **Keep user settings as the source of truth**, re-scoping only the snapshot mechanics. Rejected: the bug report is precisely that the setting is cross-session; a global default is a separate feature (settings are not session-addressable) and can be reintroduced later as a *seed* without changing the logged-state ownership.
- **In-memory per-session map**, set through the command only. Cheaper, but loses the shape across resume and fork — contradicting the repo's logged-state convention for modes — and the browser could not read the value back.
- **Projection in `dsh-api-session-controller`** (like `step-pace` and `model-selection` own theirs there). Rejected: `dsh-client-conversation-mode` is the domain owner and can run in compositions without the controller; the controller only needs the event/type vocabulary, which lives on the plugin's `./types` outlet.

## Consequences

- One session's selector can no longer reshape another session; different tabs run different shapes concurrently.
- The settings round-trip race documented by [conversation-mode-thoughts](../bug-fix/2026-10-11-conversation-mode-thoughts-every-shape.md) and the redesign brief is deleted along with the settings mirror read path.
- Stale `ui-quiet` keys in user-settings files are inert debris; there is no deletion migration because nothing interprets them.
- Package direction: `dsh-api-session-controller` gains a type-only dependency on `dsh-client-conversation-mode/types` (the same pattern as `dsh-client-file-upload`), keeping the shape taxonomy single-sourced.
