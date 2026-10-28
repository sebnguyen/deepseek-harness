# Agent Note: Warm open from remembered row heights

Status: implemented

## Problem

Opening a session mounted the content of every row in the loaded window. A dormant row reserves a measured height, and the only way to learn a height was to mount the row once, so the live set started as `new Set(order)` and the band could not narrow until the first scroll sample. At the ~4.45 ms per content row measured in the running app, a long transcript paid that on every open before anything could be dormant — and no eviction or collapse could help, because until that pass finished nothing had a height to reserve.

## Decision

The plugin remembers, per session, the measured heights and the geometry they were valid for (`chatHeights`, beside the reader position in `apply.ts`). A warm open:

- seeds `rowHeightsRef` from the snapshot, so a dormant row reserves the exact height it had;
- starts `liveKeys` as `bandAround(order, rememberedAnchorKey)` — the band around the remembered row, a node count, with no geometry read — plus the pinned tail;
- and therefore renders the band's content and exact spacers for everything else on the first commit, so `scrollHeight` is already the transcript's height and the existing restore lands on the exact position.

The snapshot carries a stamp: the column's `--dsh-chat-content-width`, its font size, and the window width. The restore layout effect compares it before paint; a mismatch saves `null` and falls back to the all-live first paint, which remeasures everything. Heights are saved on every band sample and on unmount, pruned to the rows still in the flow so the map cannot grow past the loaded window. The stamp is read from computed style, not a rect, so the save path never forces layout.

## Alternatives considered

- **Estimate the evicted or unmeasured heights.** Rejected: the whole dormancy model reserves measured heights only, and an estimate is exactly the class of number this redesign removed.
- **Let the browser remember the size with `content-visibility: auto`.** Rejected: a skipped row reports its placeholder box from `getBoundingClientRect`, so the measurement pass would cache the placeholder as a height and every spacer after it would be wrong.
- **Persist the snapshot across reloads.** Deferred: a reload usually also changes the window geometry, and the stamp can only invalidate, not validate, a stored number. In-memory matches the reader position's lifetime, which is the honest scope.
- **Evict rows to bound the scroll height.** Rejected: removing a row deletes height from the flow, which is the invariant the band, the floor, the anchored restore, and the prepend compensation all ride on. Collapsing runs into one measured-total gap remains the option if the shell count ever matters.

## Consequences

- A warm open mounts the band (at most 151 rows plus the pinned tail) instead of the whole window; the rest is a spacer with its measured height.
- A cold open — the first after a reload, or after a width, font, or window change — still mounts everything, because a height can only be learned by measuring. Making that tolerable needs progressive measurement from the anchor outward, which is not built.
- A remembered height that has gone stale (a disclosure toggled elsewhere, an image that finished loading) offsets the flow by that delta until the row mounts again and remeasures; the shift is bounded to that row.
- The arrival effect now adds only keys the flow has never seen. It previously added every key missing from the live set, so any append re-woke the whole transcript until the next sample narrowed the band again.
