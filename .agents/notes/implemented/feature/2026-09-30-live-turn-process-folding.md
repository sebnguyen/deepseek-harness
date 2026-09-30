# Agent Note: Live Turn-process folding

Status: implemented

[中文](2026-09-30-live-turn-process-folding.zh.md) | English

## Problem

Compact transcript folding applied only to closed Turns: while a Turn ran, every Context injection, Think, Tool, and intermediate Assistant row rendered fully expanded until `turn/end`, so a long-running agent turn flooded the reading surface with process material the finished-Turn design already treats as secondary. The completed-Turn disclosure also purged its folded detail bodies from the DOM (DisclosureRow unmounted closed children), which silently removed folded reasoning and context text from browser find.

## Decision

**Compact mode live-folds an open Turn.** The Turn-process projector derives, for an open Turn, the newest reply-bearing Assistant Step (`liveStep`) and whether the Turn carries foldable evidence (`liveFoldable`: a non-retry, non-independent row at or after the process start that is not that newest row). ChatNodeSeat then hides every process member except the `liveStep` row behind the Turn-process control while the Turn is open; model-retry rows stay independent in both modes. At `turn/end` the seat switches atomically to the settled answer-boundary fold, and the live expansion hands over to the persisted Turn-and-answer-Step entry.

**Manual expansion lives in the session store, keyed by Turn with a nullable answer Step.** A null `answerStep` entry records the open-Turn live expansion so every member seat of one Turn shares one open state; a settled entry records an answer generation as before. The store never mixes the two: opening a settled generation replaces the null-step entry, and closing the live expansion never removes a settled one.

**The running control is a truthful summary.** Its Tool-call, message, and subagent counts cover all durable events of the Turn; while running, the visible newest row is not yet an earlier message, so its message count is one less than the Turn-wide figure. Zero counts read `Working` (English) / `处理中` (Chinese) while the Turn is open and keep `Thought for a while` once closed.

**DisclosureRow keeps closed children mounted on demand.** A `keepChildrenMounted` prop renders closed `children` inside a `hidden="until-found"` wrapper; ReasoningRow, ContextInjectionRow, and SystemPromptRow opt in so folded detail text stays in the document for search and assistive technology, and hidden members no longer purge mid-Turn.

## Verification

ChatView specs cover the live fold's member set and hidden state, the counts and label while running, Normal-mode passthrough, hand-over at `turn/end`, and focused-row reveal; the chat-store spec pins the null-step entry lifecycle; `pnpm run test:gui` stays green across the client suites.

## Alternatives considered

**Per-seat local open state for the live fold.** Rejected: member seats are separate component instances, so one click would unhide only the clicked member; the store keeps all seats of a Turn consistent and survives remounts.

**Live-fold from the first visible chunk.** Rejected as fact projection: the projector already accumulates per-Step evidence deterministically by log seq, and deriving `liveStep` from the newest reply-bearing Assistant row keeps search-hidden and streaming rows consistent without a render-side timer.

**A separate live control Node kind.** Rejected; the settled control owns process presentation for a Turn, and splitting the lifecycle would duplicate the member-set logic across two renderers.

## Consequences

- Open Turns reflow live in Compact mode: rows fold as evidence arrives, so a reader above the tail sees the same reflow the completion fold already produces.
- A running Turn's visible Assistant row is never a fold member; when the Turn has no reply-bearing row yet, every evidence row folds behind the control.
- Closed-children mount retention is opt-in per DisclosureRow callsite; rows with heavy expanded bodies keep the unmounted default.
- The projector's presentation gains `liveStep`/`liveFoldable`; closed turns publish null/false so the completed-Turn contract is unchanged.
