# Agent Note: Step span folds replace Turn-process groups

Status: implemented

## Problem

The grouped fold reconstructed each Step's extent from sequence numbers: `turnProcessPresentations` scanned a Turn's visible nodes into runs terminated by reply-bearing Assistant rows, `presentationPosition` re-anchored controls and pre-User context, and special cases covered the Turn-opening run, the live tail, and reasoning-only answers (an anchor group at the reply row). Blocks, per-group expansion entries, and the `assistant-step` node mixing reply and reasoning in one payload all served that reconstruction. The structural unit was always the Step — one model attempt plus its tool executions — and the geometry re-derived its boundaries from anchors instead of using them.

## Decision

The Step span is the fold. `assistant-sections.ts` registers four Definitions per Step, all keyed `${turn}:${step}`: `assistant-step-start` (matches `step/start`, closes on `step/end`), `assistant-step-reason` (reasoning blocks), `assistant-step-message` (text/image blocks, the Step's sole `ConversationStepDataMap` publisher, carrying the settlement's `finalNode`/`usage`), and `assistant-step-end` (match-only `step/end`; the engine forbids updates before a Context's start match, so the closer cannot observe `step/start`). `ChatSpanFoldProjector` derives one `StepSpanFold` per Step from its materialized step-location nodes: members are `assistant-step-reason`, `tool-call`, `model-retry`, and step-located `context` rows; `toolCalls`, `subagents`, `thoughts`, and `contexts` count them; `running` persists until the closer materializes; a span exists only when its opener is present. Consecutive Steps whose message section carries no reply content share one fold — the disclosure rides the first Step's opener, leads with the folded Step range when the run spans several Steps, and counts the whole run (`N context · S subagents · M thoughts · K tool calls`), a visible reply closes the run, so long tool loops read as one summary per process stretch with the replies between, never one per `step/start`. The Chat store keys manual expansion by that run's `spanKey(turn, step)`; `ChatNodeSeat` hides foldable members while their run is closed (every span of the run resolves to the same fold object), renders `StepSpanDisclosure` only on the head opener, and leaves every message section standing alone — message-only is the default. `orderedVisibleChatNodes` drops the presentation-position machinery and sorts by node anchor, which the stream already interleaves as opener, members, closer. Turn-tail, the navigation rail, and the legacy slice read the message section kind. Deleted with the geometry: `assistant-step`, `turn-process`, `ChatTurnProcessProjector`, `TurnProcessGroup`/`ChatTurnProcessPresentation`, per-group store entries, `TurnProcessOwnerProps`, and the `compactTranscript` plumbing.

## Why sections are nodes, not events or projections

One event matches one Context per Definition (`assembler.ts`), so a settled `assistant/message` cannot fan out to per-block keyed contexts, and `SessionProjectionMap` values are whole current values per key — unordered and unstreamed — the wrong shape for a transcript. Sections get exactly one context per kind per step id, and every Definition's `match` sees the same settlement, so one event drives all span nodes.

## Alternatives considered

**Per-block nodes.** Rejected: no durable block identity survives settlement (`ContentBlock`s are positional), so live and settled nodes cannot be joined by key.

**Turn-level span.** Rejected: the fold must close at `step/end` (always appended, `agent.ts` finally) to settle per-Step.

## Verification

`assistant-sections.client.spec.ts` pins the four Definitions through the real assembler (anchors, running/closed, section omission, settlement on the message section only); `chat-store.client.spec.ts` pins `openSpans`; `chat-view.client.spec.tsx` pins seat visibility, disclosure placement, and per-span expansion; `pnpm run test:gui` and the package typecheck stay green.

## Consequences

- Default-visible rows per Step are the opener, the message section, and the closer; reasoning, Tool, and retry rows fold behind the opener's disclosure, expandable per span.
- Manual expansion is per span, not per run: opening one Step reveals all its members.
- A window that lost a span's opener renders its members visible (no fold) until the opener loads, because the projector requires the opener.
- Reasoning no longer rides the reply row; it is its own folded section node. The `message.turnProcess.*` label keys remain for the disclosure vocabulary.
- The Settings → General `Normal`/`Compact` transcript toggle is deleted with the sole behavior it governed (user product direction): `chat-settings.ts`, the `TranscriptViewRow` Settings entry, the `TranscriptViewPolicy` snapshot, and its e2e persistence case go; span folds apply unconditionally and per-span manual expansion is the only presentation preference.
- Folded members stay in the document for browser find and assistive technology: seats hand folded rows to `hidden="until-found"`, revealed through the span's disclosure, and `useFoldedHidden` keeps the folded subtree mounted through a brief fold-out on both expand and collapse before the hide applies; test DOMs without `matchMedia` hide instantly and reduced motion disables every transition.
- Live spans fold while running exactly like closed ones: the projector derives the fold from materialized members, and a span with only its opener shows a `Working` disclosure until members or the closer land.
- Step-bound injected context (reminder, reasoning-prefetch, async-tool injections delivered inside a started Step) folds onto that Step's rail with a leading context count; injections before the Turn's first `step/start` carry turn coordinates only and keep standing at the turn head.
- The disclosure seat and each folded member seat carry `data-rail="process"`; ChatView.module.css draws a 2px left rule through them and tightens consecutive rail seats to a 4px header rhythm so a run of folds reads as one process header.
- Supersedes the archived [Live Turn-process folding](../../archived/feature/2026-09-30-live-turn-process-folding.md) and [Grouped tool folds with replies rendered between](../../archived/feature/2026-10-05-grouped-tool-folds-with-replies-between.md): per-run disclosures, reply-anchored runs, live/folded projector state, and per-group store entries are replaced wholesale. [Partial history folds](2026-10-05-partial-history-folds-every-loaded-turn.md) keeps its partial-window guarantees, but fold availability is now per span — a window that lost a span's opener shows that span's members uncollapsed.
