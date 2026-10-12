# Agent Note: Conversation folds removed

Status: implemented

## Problem

The chat transcript folded each Step's work — Reasoning, Tool calls, retries, and step-scoped context — behind a disclosure on the Step's `assistant-step-start` opener, merging message-less consecutive Steps into one folded run. Every fold owed per-run expansion entries in the chat store, `hidden="until-found"` seats, fold glides, disclosure rows, and their locale vocabulary. Product direction for the conversation is a flat, always-expanded transcript: folds hid exactly the evidence reviewers wanted on first sight, the interactive expansion state was invisible in every new Session, and the fold machinery (~2,100 lines of projector, presentation, presentation contract, and tests) guarded a behavior the UI no longer shows.

## Decision

Delete the fold. The assembled stream renders the opener, Reasoning and message sections, Tool rows, and the closer in anchor order, every section expanded, with no disclosure, expansion state, or hidden seats; the boundary rows still decline their seats and render nothing. Deleted with the feature: `span-fold-presentation.ts`, `span-fold.ts`, `StepSpanDisclosure.tsx`, `fold-hidden.ts`, `TurnProcessNodeView.module.css`, the chat-store expansion entries in `stores.ts`, the fold locale vocabulary, and every fold assertion in the ui-chat client tests. The four per-Step span Definitions in `assistant-sections.ts` stay: each still owns exactly one Node per Step, the message section keeps publishing the Step's location data, and the span still delimits each Step's extent — nothing folds.

This note consolidates the three active fold records, now deleted: Partial history folds every loaded Turn, Step span folds replace Turn-process groups, and Fold runs split at mid-step user/steering prompts. Their unique rationale is preserved here: folds existed to keep long tool loops scannable as one summary per process stretch; the per-Step span replaced geometry reconstruction from sequence anchors with structural step boundaries; spliced user/steering prompts and reply-bearing messages terminated runs so fresh work stayed visible; partially loaded windows folded bounded Turns and widened their counts as older pages landed. The sidebar session-list fold in [Flat session list folds like the workspace groups](../feature/2026-10-07-flat-list-recency-fold.md) is a different surface and is untouched. Nowhere in production code, configuration, durable formats, or current documentation does the transcript fold survive.

## Alternatives considered

**Always-expanding default with the disclosure retained.** Rejected: expansion state re-initialized per Session, and the disclosure UI is what the product direction removed.

**Viewport-driven collapsing.** Rejected: the viewport row window already owns long-transcript performance; the fold conflated presentation visibility with rendering cost, and folds would double-hide rows the window already offloads.

## Conditions for reintroduction

If tool-loop noise returns as a product complaint, rebuild collapsing on the Step span — `assistant-step-start`/`assistant-step-end` contexts already delimit each Step's extent, so a projector keyed on them can fold spans without reviving the deleted geometry machinery. Folded members must stay in the document (browser find, assistive technology) exactly as the deleted implementation did.

## Verification

`packages/client/ui-chat` client tests pass against the fold-free stream; `grep -rn "span-fold\|StepSpan\|openSpan" packages/client/ui-chat/src` matches nothing; the locale dictionaries carry no fold vocabulary; the fold-defining files are absent from the tree.

## Consequences

- Every conversation event renders on first sight; revealing work no longer takes a click.
- Transcripts grow with the amount of work; the viewport row window absorbs the layout cost.
- Per-block Think disclosures (`ReasoningRow`) and per-tool-card output collapsing are separate chrome and remain.
