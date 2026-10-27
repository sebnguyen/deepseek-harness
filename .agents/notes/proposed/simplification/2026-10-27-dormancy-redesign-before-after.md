# Agent Note: dormancy redesign — before and after

Status: implemented (band + render gating + height reserve); `row-window.tsx` removal pending

## Implementation status

Shipped in `ChatView.tsx`, `ChatNodeSeat.tsx`, `ChatView.module.css`:

- **centeredKey** comes from `document.elementsFromPoint` at the scrollport
  centre, checking every element at the point for a `[data-chat-flow-key]`
  ancestor inside the list (overlays such as the to-bottom button sit on top).
  When no row answers, a binary search over the ordered rows compares rects —
  `log(rows)` reads, not a linear scan. No estimates anywhere.
- **Band** is `LIVE_BAND_NODES = 150`: a hundred and fifty rows on each side
  of the row under the viewport centre, so at most 301 live rows.
- **The newest rows are pinned** (`PIN_TAIL_NODES = 8`) whatever the reader
  looks at. They are the only rows that change on their own — the streaming
  output and the turn tail — so a reader parked in history must not unmount
  them: a remount restarts the tail's count-up, which reads as a flicker, and
  leaves the tail looking unloaded until something wakes it.
- **Heights** are measured twice: on mount, and again at the moment a row
  leaves the band (its content is still committed then, so the spacer reserves
  the height the row actually had — this also catches streaming growth,
  disclosures, and image loads without reading geometry per render). No
  per-row `ResizeObserver`: `ChatView` already owns exactly one.
- **Spacers must opt out of the declined-row collapse.** The shell rule
  `.flowItem:has(> *:only-child:empty)` also matches a childless spacer, so a
  dormant row would `display: none` and reserve nothing. The rule now excludes
  `[data-chat-flow-spacer]`, and an unmeasured row renders no spacer at all so
  it collapses exactly like a declined row (no stray margin).
- **Refs, not closures.** The scroll-sample effect mounts once (`[]` deps), so
  `order`, `liveKeys`, and `loadingOlder` are mirrored into refs; a closure
  froze the band against the mount-time list.
- **Prepend suppression** stays: the band does not move while `loadingOlder`
  or an anchor is held, so Load Earlier cannot swap content for spacers
  mid-prepend.
- **New arrivals** join the live set through an effect keyed on `order`; the
  next scroll sample narrows the band again. First paint and freshly appended
  tail rows are therefore always rendered.

Still open: deleting `row-window.tsx` (it has uncommitted edits and is now
unreferenced), and deciding whether prepend compensation needs the height
cache or keeps `pagingAnchor`.

## Problem

The current dormancy system (`packages/client/ui-chat/src/client/chat/row-window.tsx`,
`ChatNodeSeat.tsx`) works mechanically but is over-branched:

- `ChatRowWindow` mixes IntersectionObserver callbacks, a count-based live band,
  a 400 ms exit hold, tail-pinning, and per-row height measurement in one class.
- Height is measured synchronously (`getBoundingClientRect` minus padding/border)
  inside the dorm timer, then stored as React state (`dormantHeight`), which
  re-renders the seat and feeds the spacer.
- Declined rows (step boundaries, empty turn-tails) still get a full
  `ChatNodeSeat` shell + `data-row-dormant` marker + `unpadded` special-casing,
  even though they render nothing.
- Spacing is a hybrid: container `gap: 0` + per-row `margin-bottom: 4px` with an
  inline `marginBottom: 0` override for unpadded rows.
- Expandable content (accordions) triggers a layout reflow whose new height is
  never recaptured, so the reserved spacer goes stale.

## Before (current)

### Live band
- `LIVE_BAND_ROWS = 100` is a **count** threshold: dormancy engages only after
  the live count exceeds 100.
- `IntersectionObserver` uses `rootMargin: '100% 0px'` (viewport + one viewport
  above and below) — pixel-based margin, but coupled to a separate count gate.
- `overBand()` = `liveCount > LIVE_BAND_ROWS`.

### Height storage
- `dormantHeight` is React `useState` (triggers re-render on every dormancy).
- Measurement: synchronous `getBoundingClientRect().height` minus padding/border,
  run at the end of the 400 ms hold, cached in a `Map<string, number>` keyed by
  `nodeKey`, with `ESTIMATED_ROW_HEIGHT = 340` as backfill.

### Render gating
- `useChatRowWindow(nodeKey, shell)` returns `{ live, dormantHeight }`.
- `ChatNodeSeat` conditionally renders: live → slot renderer, dormant → spacer
  div with `height: dormantHeight`.
- `data-row-dormant` marker opts the shell out of the declined-row
  `display: none` rule.

### Declined rows
- `DeclinedStepBoundaryView = (): null => null` registered for
  `assistant-step-start` and `assistant-step-end`.
- These rows still get a full `.flowItem` shell, an observer target, a
  `data-row-dormant` marker, and `unpadded` special-casing.

### Expandables
- No height recapture on accordion expand/collapse.

### Spacing
- One container `gap: 8px` on the flow column. No per-row margin: the design
  layer resets `margin` on user/steering rows, so a per-row margin gave those
  pairs no space at all. A container gap is uniform, and it is safe with
  dormancy because a dormant row keeps the geometry of the live one and a
  row that renders nothing is `display: none` (no flex item slot, no gap).

### Data flow
```
order: string[]  (from snapshot builder)
  → ChatNodeList maps to <ChatNodeSeat key={nodeKey} />
  → each seat has internal wrapperRef (DOM ref)
  → useChatRowWindow uses IntersectionObserver on wrapperRef
  → { live, dormantHeight } gates render
```

## After (proposed)

### Live band — node-count based
- The live band is defined by **row count**, not pixels: `LIVE_BAND/2` rows
  above the first visible row and `LIVE_BAND/2` rows below the last visible row.
- A row is live if its index falls within `[firstVisible - band/2, lastVisible + band/2]`.
- No IntersectionObserver. `centeredKey` is found via `elementFromPoint` on the
  viewport center (O(1), no heights). The band is `centeredIndex ± LIVE_BAND/2`
  in node index space. Pure math, no estimates.
- This is how react-window / TanStack Virtual work: track indices, not pixels.

### Height — child measures, reports via callback
- The child (`ChatNodeSeat`) owns its own DOM ref internally. It measures its
  height on mount (`useEffect`) and on any reflow trigger (expand, collapse,
  image load, content change).
- After measuring, the child calls `onHeightChange(key, measuredHeight)` to
  report upward. The parent stores heights in a `Map<string, number>`.
- No refs cross the parent-child boundary. No `useImperativeHandle`.
- The child's mount/unmount lifecycle and reflow triggers are the recapture
  mechanism — every mount, unmount, or reflow re-measures and reports.

### Data arrays
- `nodes: string[]` — node keys from the snapshot builder (same as today's
  `order`). No ref objects in the parent.
- `heights: Map<string, number>` — measured heights, updated via callback.
- `liveKeys: Set<string>` — derived from `centeredKey + LIVE_BAND/2`.
  Computed on scroll (throttled) via `elementFromPoint`, not stored in nodes.
- `centeredKey: string | null` — node at viewport center, found via
  `elementFromPoint`. Used for band computation and scroll anchoring.

### Render gating — conditional render
- For each node key in `nodes`:
  - If `liveKeys.has(key)` → render `<ChatNodeSeat live={true} />` (content)
  - Else → render `<ChatNodeSeat live={false} />` (spacer reading from
    `heights.get(key)` — if not measured yet, the row hasn't gone dormant,
    so no spacer is needed)
- The parent passes `live` as a prop. The child decides what to render.
- No per-seat `useChatRowWindow` hook. No `data-row-dormant` marker.

### Child component (`ChatNodeSeat`)
```tsx
function ChatNodeSeat({ nodeKey, live, onHeightChange, ...props }) {
  const ref = useRef<HTMLDivElement>(null);

  // measure on mount
  useEffect(() => {
    if (ref.current) onHeightChange(nodeKey, measure(ref.current));
  }, [nodeKey, onHeightChange]);

  // recapture on expand/collapse
  const handleExpand = useCallback(() => {
    setExpanded(prev => !prev);
    // after reflow settles:
    requestAnimationFrame(() => {
      if (ref.current) onHeightChange(nodeKey, measure(ref.current));
    });
  }, [nodeKey, onHeightChange]);

  return (
    <div ref={ref} className={css.flowItem}>
      {live ? <Content onExpand={handleExpand} /> : <Spacer height={heights.get(nodeKey)} />}
    </div>
  );
}
```

### Expandable prop
- Expandable containers declare an `expandable` prop.
- When toggled: the container reflows, then `requestAnimationFrame` captures
  the new height and calls `onHeightChange`.
- The parent updates `heights` → `liveKeys` recomputes → render adjusts.
- Any field that triggers a reflow calls `onHeightChange` after the reflow
  settles. The child owns this — the parent just receives the updated height.

### Non-matching events
- Events that do not correspond to any `ChatNode` kind do **not** get a
  container, a height entry, or a render slot.
- Only nodes that render content (or need to serve as scroll anchors) get
  entries in the `nodes` array.
- Declined rows that are pure delimiters with no scroll-anchor role are dropped
  entirely. If a declined row IS needed as an anchor, it gets an entry with
  `height = 0` and no content rendering.

### Spacing
- With declined rows no longer in flow (no shell, no gap contribution), the
  spacing model simplifies to a single container `gap: 4px` (or per-row margin)
  without the `unpadded` special-case.

### Data flow
```
nodes: string[]  (from snapshot builder, same as today's order)
  + heights: Map<string, number>  (updated via onHeightChange callback)
  + liveKeys: Set<string>  (computed from centeredKey + LIVE_BAND/2)
  + centeredKey: string | null  (computed from elementFromPoint, no heights)
  → ChatView maps over nodes:
      live = liveKeys.has(key)
      <ChatNodeSeat key={key} nodeKey={key} live={live} onHeightChange={...} />
  → child measures itself, reports height via callback
  → parent updates heights → liveKeys recomputes → render adjusts
```

### Key differences

| Aspect | Before | After |
|---|---|---|
| Live band | Count-based (100) + pixel margin (IO) | Node-count based (LIVE_BAND/2 above/below) |
| IntersectionObserver | Yes, per row | No — replaced by index math |
| Height storage | React state + sync layout read | Callback-reported, stored in Map |
| DOM refs in parent | `wrapperRef` per seat | None — child owns its ref |
| Render decision | Per-seat `{live, dormantHeight}` hook | `liveKeys` set + conditional render |
| Expandables | Stale height after reflow | Re-capture on every reflow trigger |
| Declined rows | Full shell + observer + special-casing | No shell, no entry, no observer (unless anchor) |
| Spacing | Hybrid gap + per-row margin + unpadded | Single model, no special-casing |
| Data arrays | `order: string[]` + per-seat refs | `nodes: string[]` + `heights: Map` + `liveKeys: Set` |

## Open questions

1. **Scroll anchoring for dropped declined rows.** Declined rows currently serve
   as `data-chat-anchor-key` anchors for prepend compensation and paging. If they
   are dropped, anchoring must move to the nearest surviving row. Is that
   acceptable?
2. **Height cache for variable rows.** Height is only needed for spacers
   and scroll anchoring. Spacers use measured heights (no estimate). Scroll
   anchoring uses the height cache (measured values only). No `ESTIMATED_ROW_HEIGHT`
   anywhere. Confirmed: no estimates in the design.
3. **Live band size.** What is `LIVE_BAND`? Currently 100 rows. Should it be
   smaller (e.g., 20-40) since it's now purely node-count based?
4. **Expandable detection.** `requestAnimationFrame` after state change vs
   ResizeObserver. Explicit is simpler but requires every expandable to call
   `onHeightChange`. ResizeObserver is automatic but adds per-row observers.
5. **First mount.** On first render, `centeredKey` is found via
   `elementFromPoint` (rows are in the DOM). The band is computed from
   `centeredKey ± LIVE_BAND/2`. No heights needed. Spacers aren't needed on
   first render (nothing is dormant yet). No estimate required.
6. **`onHeightChange` identity.** The callback must be stable (useCallback) to
   avoid re-running the mount effect on every render.

## Scrollbar and scrollHeight calculation

### Shells are always in the DOM
- Every row has a `.flowItem` shell, regardless of live/dormant state.
- **Live row:** renders content (natural height, browser computes it).
- **Dormant row:** renders spacer with `height: measuredHeight` (from height cache).
- **Not-yet-measured row:** shell exists with 0 height (or CSS `min-height`),
  contributes nothing until measured.
- The browser computes `scrollHeight` from the DOM. No estimates in JS.

### Lifecycle
```
1. First render: all shells mount at 0 height (or min-height).
   scrollHeight = 0 (or small). Scrollbar at top.

2. Rows in viewport mount → measure → report height via onHeightChange.
   Parent updates heights Map → re-renders → shells grow to measured height.
   scrollHeight increases. Scrollbar adjusts.

3. User scrolls down:
   → centeredKey found via elementFromPoint
   → liveKeys recomputed (centeredIndex ± band/2)
   → rows leaving the band: measure → spacer replaces content
   → rows entering the band: spacer → content (height already cached)
   → scrollHeight stays stable (measured heights, not estimates)

4. User scrolls back up:
   → dormant rows wake: spacer → content
   → height already cached, no re-measurement needed
   → scrollHeight unchanged
```

### Why this is better than estimates

| | With estimate (current) | Without estimate (proposed) |
|---|---|---|
| First paint | scrollHeight = N × 340px (wrong) | scrollHeight = 0 (or min-height × N). Grows as rows measure. |
| After mount | scrollHeight converges, but estimate caused initial jump | scrollHeight converges, no initial jump from wrong estimate |
| Dormant spacer | 340px (wrong for most rows) | Measured height (correct) |
| Jitter | Estimate → measured causes scrollHeight change | Only measured values, no estimate→real transition |

### First-paint scrollbar
- On first render, the scrollbar is at the top with height ~0.
- As rows mount and measure (within the first frame or two), the scrollbar grows.
- This is a brief flash — acceptable for a chat transcript where rows mount
  synchronously.
- If the flash is unacceptable: render a small initial set of rows without
  virtualization, measure them, then enable virtualization. (Two-pass approach.)

## Effort assessment

### Files touched

| File | Change | Size |
|---|---|---|
| `row-window.tsx` | Remove IntersectionObserver, count-based band, height measurement. Replace with node-count band computation + centeredKey via elementFromPoint. | ~260 lines rewritten |
| `ChatNodeSeat.tsx` | Remove `useChatRowWindow` hook. Add `live` prop, `onHeightChange` callback, measure on mount + reflow triggers. | ~100 lines rewritten |
| `ChatView.tsx` | Add `liveKeys` computation from scroll position. Pass `live` to seats. Wire `onHeightChange`. Update scroll anchoring (prepend compensation uses height cache). | ~693 lines, moderate edits |
| `ChatView.module.css` | Remove `data-row-dormant` exclusion (no longer needed). Simplify spacing (no `unpadded`). | ~225 lines, small edits |
| `register-node-renderers.ts` | Remove `DeclinedStepBoundaryView` or keep as null renderer (no shell needed). | ~64 lines, small edits |
| `chat-snapshot-builder.ts` | Possibly remove declined nodes from `order` (if no shell needed). Or keep for anchoring. | ~933 lines, small edits |

### New code needed

- `computeLiveKeys(centeredKey, nodes, band)` — pure function, index math.
- `centeredKey` computation via `elementFromPoint` — O(1), no heights.
- `onHeightChange` callback wiring — stable via `useCallback`.
- Scroll anchoring update — prepend compensation using height cache.

### Risk areas

1. **Scroll anchoring (prepend compensation).** Currently uses `pagingAnchor`
   which walks DOM. Needs to work with the new height cache. This is the
   most fragile part — if heights are wrong, prepend compensation breaks.
2. **Follow-scroll / to-bottom logic.** Depends on `scrollHeight`, which changes
   as rows mount/measure. The existing follow-scroll logic should still work
   since it reads `scrollHeight` dynamically, but timing may shift.
3. **Browser find (`until-found`).** Relies on DOM being present. Shells are
   always present, so this still works. No change needed.
4. **Tests.** `chat-row-window-styles.client.spec.ts` pins selectors that would
   change. `turn-tail-spacing.client.spec.ts` checks `--dsh-chat-flow-gap`
   absence. Both need updating.

### Effort estimate

- **Core logic:** 2-3 days (row-window rewrite, ChatNodeSeat rewrite, ChatView
  integration, height cache wiring).
- **Scroll handling:** 1-2 days (anchoring, follow-scroll, to-bottom — the
  most fragile part).
- **CSS cleanup:** 0.5 day (remove data-row-dormant, unpadded, simplify spacing).
- **Tests:** 1 day (update existing, add new for node-count band).
- **Total:** ~4-6 days of focused work, with significant manual testing needed
  for scroll behavior (prepend, follow, find, expand/collapse).

### Phasing recommendation

1. **Phase 1 (low risk):** Remove shells for declined rows that are pure
   delimiters. Keep shells for everything else. Update CSS.
2. **Phase 2 (medium risk):** Replace IntersectionObserver with node-count band.
   Add `centeredKey` via `elementFromPoint`. Add `liveKeys` computation.
3. **Phase 3 (medium risk):** Add callback-based height reporting. Remove
   `heightRef` from parent (child owns it). Update spacer rendering.
4. **Phase 4 (high risk):** Update scroll anchoring (prepend compensation) to
   use height cache. Test thoroughly.
5. **Phase 5 (low risk):** Remove `data-row-dormant`, `unpadded`, `ESTIMATED_ROW_HEIGHT`.
   Clean up CSS.


## Related

- `2026-10-23-dormant-chat-rows-keep-height.md`
- `2026-10-26-dormant-row-spacer-double-padding.md`
- `2026-10-26-declined-dormant-row-reserves-padding.md`
- `2026-10-26-chat-row-window-band-100.md`
