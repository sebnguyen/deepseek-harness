# Agent Note: the sidebar slide clips a frozen browsing region

Status: implemented

## Problem

Expansion and collapse animate the sidebar column's `width` over 300ms through the Web Animations API. The browsing region is a normal flex child, so it follows that width and the whole workspace browser — section header, search, session tree — re-lays-out on every frame of the slide. Concealing the panel during an expansion hold (`.contentHidden`) uses `opacity: 0`, which removes paint but leaves layout running: a 200-row reproduction of the slide costs about 40ms of layout across its 18 frames with the content transparent, against about 2ms when the region keeps a fixed width and the column clips it. `visibility: hidden` measures the same as `opacity` for the same reason — the boxes stay in flow.

## Decision

`SidebarRoot` wraps the `sidebar.workspaces` seat in `.regionBox` and gives that box the expanded content width and the column's inline padding whenever `wide` is true — an expansion, the collapse crossfade, and a pinned panel alike. `.root` gains `overflow: hidden`, so the sliding column clips the region instead of resizing it. The region's own `flex: 1` and negative bleed margins stay; inside the fixed box they resolve to the same edges the stretched box had at rest. In the rail state the box carries no inline width and stretches as before.

The frozen width mirrors `--dsh-sidebar-inline-padding` as a TypeScript constant, the same mirroring `SidebarRoot.tsx` already does for the rail width and the slide timings; `sidebar-styles.client.spec.ts` pins the CSS value.

The session list now mounts once and survives the fold: `WorkspaceBrowser` wraps the tree in `.listBody`, which is `display: contents` while wide (its root stays the list area's flex child) and `display: none` in the rail. A fold change toggles that class instead of unmounting the tree, so hovering a collapsed rail neither rebuilds nor re-lays-out the list. The active search is the one exception: its results still unmount in the rail, because a hidden panel must not keep a Host content search running. `revealSessionId` is withheld while the rail is settled so a reveal request is not consumed by an unrendered row; the same request re-runs when the panel widens.

## Alternatives considered

**`content-visibility: hidden` on the concealed content.** One declaration, and it skips the subtree's layout outright, but it also skips hit-testing, focus, and measurement for the whole 300ms window. The region's search-focus and session-reveal timers run on the same 300ms schedule, so they would execute against a skipped subtree.

**Animate a clip or a transform instead of `width`.** Compositor-friendly, but the panel's hit area and the rail's 56px seat are geometry the rest of the frame reads; the width is the slot's own size.

## Consequences

- The workspace browser lays out once per fold change instead of once per frame; the slide only re-paints the clipped region.
- The session tree stays mounted while the rail is settled: it keeps its React state and DOM, and pays subscription work for session updates in both fold states instead of only while open.
- A pinned drag still writes the column width directly and the frozen box follows `openWidth`, so the panel edge stays on the handle.
- The region box adds one DOM node between the shell and its slot; direct-child fade selectors now animate the box as one unit.

## Testing

`sidebar-root.client.spec.tsx` pins the region box's width while expanded and its absence in the rail; `sidebar-styles.client.spec.ts` pins `.root`'s `overflow` and the box's flex contract; `workspace-browser.client.spec.tsx` pins the list surviving the fold, and `browser-styles.client.spec.ts` pins the `.listBody` toggle.
