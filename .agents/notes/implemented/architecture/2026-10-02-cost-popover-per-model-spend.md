# Agent Note: Cost popover lists per-model spend, projection stays per-scope

Status: implemented

## Problem

The composer cost chip priced the whole session under the deployment's rate table and its hover popover repeated that rate table. Rates explain *how* the figure was computed but not *what was spent*, and they hide the one question the chip invites: which models did this session's invokes cost, and how much? Subagent sessions compound the gap — each child session folds its own `sessionCost` (by design, per-scope), so a parent session's chip silently omitted everything its subagents spent. [Per-model cost pricing](../feature/2026-10-02-per-model-cost-pricing.md) had already keyed the fold's rates by the logged model id; the popover still repeated that rate table rather than the spend it produced.

## Decision

**The `sessionCost` fold keeps one spend entry per provider-logged model.** `perModel` keys `CostModelSpend` (the four token buckets plus `costMicros`) by `message.source.model`; events without a logged model accumulate under the empty string. Each entry rounds its micros independently of the whole-log total, and the unit's `stateVersion` moved 1 → 2 so persisted projection-cache rows folded under the old state fold again instead of validating against the new schema.

**The cost popover lists spend, not rates.** One line per model — amount plus total tokens, most expensive first, ties by model id — and the empty model key renders through a locale-owned "unlogged model" label. The rate-table listing (`stats.costRatesTitle` / `stats.costRateLine` / `stats.costRateFallback`) left the `ui-chat` locale with the popover that used it.

**The client, not the projection, rolls descendants into the popover.** `StatsPills` extends the viewed session's own `perModel` with every descendant session the sessions-list rows connect through `parentId` chains — subagent sessions ride the list with their header's `parentSessionId` and their cached `sessionCost` value whether or not they were opened. The rollup cuts a cyclic parent chain at its first repeated id, counts unpriced descendants in the closing "includes N subagent session(s)" row without adding micros, and never fetches: it reads only the served projection of the viewed session and the list store. The projection itself stays per-scope — a session's `sessionCost` is still exactly its own log's spend — so the list row, the SDK, and any other consumer keep a spend figure that paging, compaction, and tree shape cannot change.

## Alternatives considered

**Server-side tree aggregation in the fold.** A projection unit sees only its own session's log; aggregating children would need a cross-session scan or a new cross-session event channel for every commit, and would drag the parent's figure wherever a child mutates. The list already publishes each child's cached value and its parent edge, so the one consumer that wants a tree view assembles it from exactly those rows.

**Client-side per-model spend from the paged chat window.** Window folds are what compaction and Load-earlier rewrite; accounting that must survive paging rides the durable whole-log projection, which is why the fold — not the snapshot builder — owns `perModel`.

**Keep the rate table beside the spend listing.** The rates are deployment configuration the user already set; repeating them in the popover answered a question nobody asked while crowding out the one they do. Rates remain recoverable from the same projection's `rates` field for any future consumer.

## Consequences

- `sessionCost` wire output gains `perModel`; the state bump drops cached v1 rows at read time instead of failing them.
- Per-entry rounding means a sum over `perModel` costs can differ from `costMicros` by fractions of a cent; consumers present either, not an equality.
- The popover's descendant rollup is as fresh as the list store: a child session not yet listed (catalog pending) joins on the next list increment, and an unpriced deployment child counts as included but adds no rows.
- `StatsPills` now reads the sessions list (`useSessions`) and the viewed session id from the standard seats, so its fixture specs must supply both.
