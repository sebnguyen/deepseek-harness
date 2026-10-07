# Agent Note: Stats pill speed chip pools the recent five requests

Status: implemented

## Problem

The time pill's aggregate speed chip pooled decode throughput over the whole durable log: its value rode the `sessionStats` projection (or the window fold as fallback), so a long session displayed a number dominated by accumulated history. A user asking "how fast is it decoding now" read a figure that barely moved after a slow or fast stretch, while the neighboring last-request chip swung with every single request. The pill offered no reading between one request and all of them — and a window-only recent reading would itself vanish whenever the loaded window carried no per-step timing, exactly the reload case the durable projection had made every other figure proof against.

## Decision

The pill's aggregate chip pools the up-to-five most recent sampled steps — steps carrying both decode timing and provider usage — labeled "Last 5" / 「近 5 次」. The pool is durable: the `sessionStats` projection folds a bounded ring of the five newest `(decodeMs, tokens)` readings into its state and serves their pooled `recent5DecodeMs` / `recent5DecodeTokens` beside the whole-log totals, so reloads, paging, and compaction cannot drop the chip; the window fold in `packages/client/ui-chat/src/client/chat/StatsPills.tsx` mirrors the two fields as the assembly-without-the-unit fallback, and `recentRequestTps(nodes, 1)` keeps the newest-request chip window-scoped. The whole-log average leaves the pill and stays in the time-and-speed dialog as the "Average tokens per second (TPS)" row, beside "Last 5 request speed" and "Last request speed".

The ring changes the fold's state and output, so the projection's `stateVersion` moves 1 → 2: persisted `ver 1` cache rows fail the registry's `ver` match on restore and the key refolds from `init` over the full log — the projection registry's designed upgrade path, one lazy full-log fold per session on first open after deployment.

## Alternatives considered

**Keep the whole-log average on the pill and add the recent-five reading only to the dialog.** The pill is the glanceable surface; the complaint was exactly that its aggregate number no longer described current performance, so dialog-only placement would have left the visible figure stale.

**Average the per-request tok/s readings.** Five per-request ratios averaged arithmetically weight a 10-token reply the same as a 10K-token one. Pooling tokens over decode seconds keeps the chip's math identical to the dialog's whole-log figure, so the two readings stay directly comparable.

**Derive the recent five only from the loaded client window.** That is what shipped first and regressed visibly: a reloaded session's paged window tail carries no timing (it rebuilds from flattened rows), so both chips dropped even though the session had decoded fine. Recency is exactly the fact a window fold loses to paging, so it rides the durable fold like every other pill figure.

## Consequences

- `SessionStatsProjection` grows `recent5DecodeMs` / `recent5DecodeTokens`; the fold state grows the bounded five-entry ring; `packages/client/connection`'s fixture parity fold computes the same two fields. The web chat pill, the fixture, and the specs are the view's consumers; no SDK or Python golden enumerates the `sessionStats` view.
- Old persisted `sessionStats` caches refold once at `ver 2`; the strict `viewSchema` means a stale row can never serve a view missing the recency fields.
- The steer-all and skill-user-invoke web e2e aria goldens carry the new chip label; the unit suites pin the ring's oldest-first aging and the pill's projection-over-window sourcing.
