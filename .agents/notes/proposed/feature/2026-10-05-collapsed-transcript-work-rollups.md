# Agent Note: Cursor-style collapse of non-user-facing transcript activity

Status: proposed

## Problem

The Web trajectory renders nearly every session record at the top level of its turn. In a working session the human exchange — user prompts and assistant prose — is buried between context injections, tool calls and results, nested subtool calls, assistant reasoning, and compaction markers; a long session reads as a scroll of machinery. Cursor-style clients solve this by folding internal activity into collapsed "working" rollups that expand on demand. In this stack, hiding must be presentation-only: the append-only log keeps every event, the model-visible ⟺ logged invariant holds, and log replay must produce the same groups the live view showed.

The discriminators this needs are already logged. `user/message.source` separates a direct human prompt from synthetic `agent.inject()` context and goal continuation rounds; the trajectory cell model already carries `thinkingDetail` for assistant reasoning and a `subtool` kind for nested workflow calls; compaction has its own event types and a trajectory definition; and [dsh-session-turn-outline](../../../../packages/session/session-turn-outline/README.md) already excludes injected context and tool results from its previews. What does not exist is the grouping layer: no projection classifies session events by audience, and the trajectory renderer has no collapsible container row between user and assistant records.

## Proposal

### Audience taxonomy as a pure fold

A browser-safe projection package, mounted beside the session-projection registry like `dsh-session-turn-outline`, folds the log into transcript rows and classifies each row into one audience, derived from event type and payload alone:

- `primary` — human-source `user/message` rows and assistant text content.
- `work` — tool calls, tool results, subtools, workflow agent/run records, and assistant reasoning blocks.
- `context` — injected `user/message` rows (non-human source), system prompt updates, and request headers.
- `chrome` — compaction markers, hooks, retries, approvals, todo/plan/goal/claim/schedule records, and telemetry.

The type switch ends in a documented default that maps unknown merge-extensible and `ignorable` event types to `chrome`, so out-of-repo plugin events collapse instead of breaking the transcript.

### Rollup grouping

Within a turn, each maximal run of consecutive non-`primary` rows folds into one collapsible rollup row. While a step is live the open rollup streams a count summary ("2 tool calls · 1 injection · thinking"); a settled rollup states the same summary in past tense. Expanding renders the members exactly as today — tool cards under [client-derived tool presentation](../../implemented/architecture/2026-08-23-client-derived-tool-presentation.md), context records, compaction divider, subtool nesting intact. Runs split rather than regroup across a `primary` row, so a streamed assistant paragraph never re-keys rows above it.

### Defaults, preferences, and failure legibility

`work`, `context`, and `chrome` rollups default to collapsed; expansion is ephemeral per-turn UI state, with one user setting to expand work by default. A rollup containing a failed tool result or rejection shows the warning in its header count and auto-expands on navigation, keeping failure detail legible the way the [background-activity drawer](2026-09-30-web-background-activity-drawer.md) requires for failed jobs. The header is a disclosure button following the TodoDock `aria-expanded` pattern.

### Ownership and parity

The fold runs on append-origin events, is pure over the log, and ships browser-safe so Web and any future client share it. The ui-trajectory view consumes the grouped row model; virtualization measures a collapsed rollup as one row. ACP and the SDKs keep their raw streams untouched: collapse is a presentation surface, not a third transcript representation.

## Alternatives considered

**A persisted envelope audience field.** Storing `audience` per event re-derives what type plus `source` already determine, costs a wire and schema change plus a default rule for pre-field logs, and repeats the shape of the event-name-registration mechanism the [ignorable-event decision](../../implemented/architecture/2026-08-30-retain-ignorable-external-session-events.md) rejected. Derivation keeps old logs classifiable unchanged.

**Client-only grouping inside ui-trajectory.** Fastest to ship, but the taxonomy then lives in a browser bundle, untestable by host snapshot tests and unshareable with SDK consumers and maintainer replay tooling. Hosting the fold in a projection package keeps it a keyless-testable pure function, like the turn outline.

**Server-pushed grouped transcript frames from the session controller.** The controller already folds mirrors for jobs and subagents, but a pushed grouped row model adds a second wire representation of the transcript that must be proven equivalent to the raw log; deriving the same rows client-side reuses existing frames.

**Per-cell default-collapse without grouping.** Cells already carry details panels, but forty collapsed rows are still forty rows of chrome; the complaint is vertical rhythm, which only grouping removes.

## Acceptance criteria

- The projection package folds a hand-built log spanning all four audiences, a live step boundary, a surface replacement, and an unknown `ignorable` event into the expected row sequence, with runs split across `primary` rows and the unknown event classified `chrome`.
- A keyless Web e2e extending the trajectory scenario: a turn containing tool calls and one injection renders a user row, one collapsed rollup, and an assistant row; expanding shows the tool cards and the context record unchanged; a compaction marker renders inside the rollup; a failing tool call puts a warning in the rollup header.
- Replaying a recorded session through the same scenario renders identical groups to the live view.
- The rollup header toggles by keyboard with `aria-expanded`, honoring reduced motion.

## Risks

- The grouped row model reworks the virtualized trajectory renderer's height measurement; expand/collapse scroll anchoring is the largest engineering surface in the change.
- The taxonomy must name an audience for each new event type at introduction; the `chrome` default protects the transcript but would silently hide a future user-facing event, so a snapshot test enumerates the expected audience of every `KNOWN_SESSION_EVENT_TYPES` member and fails on drift.
- Over-collapse makes reasoning invisible to users who watch it; the always-visible count summary keeps it one keystroke away and the preference flips the default.
- Surface replacements shadow append-origin rows; the fold consumes append-origin events per the `isAppendSurfaceEvent` precedent so a replaced range keeps its original rollup membership instead of orphaning.
