# Agent Note: Fold runs split at mid-step user and steering prompts

Status: implemented

## Problem

`ChatSpanFoldProjector` merged consecutive message-less Steps into one fold run terminated only by a visible assistant reply. A prompt spliced into an active turn sat inside that run: the Steps after the prompt folded under the run head's disclosure, so the work answering the reader's latest message hid above it. The first cut split only prompts carrying Step coordinates (inbox `next-step` claims); ordinary spliced submissions carry turn coordinates only, so the split silently never fired on live sessions.

## Decision

A prompt is a run boundary two ways, exactly like a reply-bearing message section: a step-local `user` or `steering` node sets `splitBefore` on its Step, and a turn-scoped prompt (no Step coordinates) records its log seq; `computeTurn` closes the run before the first Step whose earliest node seq postdates that prompt. The message section still splits and stands alone as before; turn-head context, tool results, retries, and reasoning keep folding with their Step.

## Alternatives considered

**Seq-window scans reconstructing span anchors.** Rejected as the whole mechanism: it rebuilds the anchor geometry [Step span folds replace Turn-process groups](2026-10-07-step-span-folds-replace-turn-process-groups.md) deleted. The seq remains only as the ordering key between an already-materialized span's first node and a turn-scoped prompt's anchor — no reconstruction.

**Folding the prompt as a span member.** Rejected: it hides the reader's own message under a disclosure, the exact complaint the boundary fixes.

## Why the boundary is structural, not geometric

Step-coordinate prompts are observed directly by the node-kind switch; turn-scoped prompts have no span anchor to observe, so their recorded log seq compared against each span's first node seq is the minimal remaining ordering fact.

## Verification

`conversation-node-definitions.client.spec.ts` pins both boundaries: a steering spliced with `next-step` claims between two message-less Steps, and a turn-scoped `user/message` at a seq between the Steps' events, each yielding two separate folds (`endStep` equals each span's own `step`); the run-sharing, partial-window, and steering-order cases stay green.

## Consequences

- The transcript reads one disclosure per process stretch between reader messages; a fold never covers work on both sides of a prompt, and when a prompt lands inside the run head's span the disclosure rides that prompt row instead of the opener above it.
- `ui-chat` README's Step Span Folding section names the prompt boundary beside the reply boundary.
- Runs can now close at a Step that later gains a steering row; the fold re-derives by the existing `update` invalidation, because the boundary node is a step member the store touches.
