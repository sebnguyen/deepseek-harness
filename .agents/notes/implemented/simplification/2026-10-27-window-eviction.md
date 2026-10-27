# Agent Note: Release the history window the reader scrolled past

Status: implemented

## Problem

The loaded window was, in practice, the whole session. Dormancy and the warm-open height cache made the *band* cheap, but the window itself still carried every event of the conversation, every derived projection entry, one shell per node, and a scroll range that covered the entire transcript. Nothing released it, and `hasMore` only ever went false.

## Decision

The view releases the prefix it has scrolled far past, and the released history stays one Load Earlier away.

- `ChatView`'s existing scroll sample computes the band top. When it sits more than `EVICT_MARGIN_NODES + EVICT_CHUNK_NODES` (200 + 200 rows) below the flow head, the sample captures the reader's row and top and calls `evictBefore` with the seq of the row 200 above the band.
- `Session.evictBefore(seq)` snaps forward to a `turn/start` — a turn is projected from its whole event range, so a half-evicted turn is a broken projection, not a shorter window — then moves `baseSeq`, sets `hasMore = true`, trims the transport's head cursor, and replaces the event window. The assembler rebuilds from the shorter window through its existing `replace` path.
- The layout pass that drops the rows restores the reader's row from the captured top, so nothing moves under the reader. Measured heights are kept for released keys, so paging them back reserves exact geometry and needs no mount to measure.

## Alternatives considered

- **A two-second scan.** Rejected: eligibility only changes when the band moves or the head moves, and the sample already observes both. A timer would fire while nothing changed, and could fire mid-gesture.
- **Deleting rows from the node array.** Rejected: `order` and the node maps are derived from the event window on every publication, so the next event restores whatever was deleted. The window is the only durable boundary.
- **A fixed retention cap in the controller.** Rejected: it cannot see the band, so it can release rows the reader is looking at while a long turn streams at the tail.
- **Collapsing shells into one gap instead.** Still viable if only per-render cost matters, but it frees no memory.

## Consequences

- The scrollbar now covers the retained window, not the session. Reaching released history is a page load, not a scroll.
- A saved reader position inside released history cannot be restored; the restore falls back to the clamped `scrollTop`.
- `hasMore` is no longer monotonic. `loadThrough`'s page loop and `forkAt` key off `baseSeq` and still work, from a later base.
- Released turns lose their timings, usage, and outline entries until they are paged back in.
- Every release rebuilds the projection over the *retained* window, which is why the release comes in a 200-row chunk: one rebuild per page of growth rather than one per crossing row.
- A cut already requested is not requested again until the head actually moves, so a slow window update cannot queue duplicate releases.
- The transport needed a head-cursor trim (`RemoteJournalStream.truncate`, added): without it, `loadOlder`'s page is filtered away as already held.
