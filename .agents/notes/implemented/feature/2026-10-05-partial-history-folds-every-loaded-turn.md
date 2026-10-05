# Agent Note: Partial history folds every loaded Turn

Status: implemented

## Problem

The compact transcript's Turn-process fold initially suspended itself for the Turn that begins above the loaded window whenever an older history page stayed unloaded, because that Turn's process spec sees only the loaded suffix and its Tool-call and message counts would understate the Turn's true totals. In a long-running session the paged window starts mid-Turn, so the one Turn a returning reader most wants collapsed — the large historic one on screen — was the one left fully expanded, reading as "folding works only for the recent Turns".

## Decision

**Remove the boundary exemption.** Compact mode folds every loaded Turn, including the one that begins above the loaded window, superseding the same-day boundary paragraph of [Live Turn-process folding](2026-09-30-live-turn-process-folding.md). The projected spec always covers the load window truthfully: its counts describe the loaded evidence and re-derive when the older page lands, so the disclosure's numbers widen instead of having been wrong. A reader who expands the boundary Turn and then loads older history keeps the widened rows open under the persisted open entry.

## Verification

`packages/client/ui-chat/tests/chat-view.client.spec.tsx` pins a boundary Turn folding under `hasMore` with its rows search-hidden, and a two-Turn partial page folding both groups; `pnpm run test:gui` and the repository typecheck stay green.

## Alternatives considered

**Keep the boundary expanded (shipped earlier the same day).** Rejected after reading the live transcript census: the exempt Turn is exactly the expanded wall of process rows the fold exists to remove, and a truthful-but-partial count that completes on load serves the reader better than a complete-but-invisible one.

**Mark the boundary control with a "more above" affordance.** Rejected as invented chrome; the counts already change visibly when the older page loads, and the control expands to the widened member set on demand.

## Consequences

- Under partial history the first loaded Turn's disclosure undercounts until the older page loads; loading older history re-derives the spec and the control label in place.
- The fold no longer waits on the older-history boundary at all: `ChatNodeSeat` reads no session paging fact, and the per-Turn presentation alone drives member hiding.
