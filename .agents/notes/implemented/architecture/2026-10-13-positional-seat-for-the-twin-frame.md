# Agent Note: A positional, root-lifetime seat for the VS Code twin frame

Status: implemented

## Problem

The twin was mounted by two registrations in two scopes glued together by a polling loop, and the glue bred regressions. The session-scoped `sidebar.right.pane.tab` body rendered only a placeholder box (`data-twin-stake`), while a root-scoped `shell.overlay` host portalled the real `<iframe>` to `document.body` and a 16 ms interval copied the placeholder's `getBoundingClientRect()` onto a `position: fixed` container. Geometry, stacking, and visibility were renegotiated by hand for every layout feature, outside the layout system that owns them.

The cost was measurable. In the float design's first three days (2026-10-10 → 2026-10-12) the twin surface absorbed 22 of the repo's 51 commits and 8 of its 14 fixes, in same-day feat→fix chains: iframe transparency (`e7b33ff064` → `1c1e0e62f5`), floating-cards gutters (`22d98e7b0f` → `c6489b9617`), session-vs-workspace keying (`5aacb573ea` → `25b2d667fa`), side-bar side (`c7b076158f` → `56a879cfff`). The same mechanism then broke the chat↔IDE divider outright: the float stacked at z 12 **above** the drag handle's z 11 while living in `document.body`, outside `.frame`'s stacking context — and the swapped-layout handle formula at `AppFrame.tsx` omitted the second frame inset, so the handle strip sat inside the IDE card edge exactly where the transparent iframe swallowed its pointer events. The z-band contract (10/11/12/20/40/45/60) spanned three packages with hand-tuned literals.

The essential problem the float solved is real: an `<iframe>` cannot be reparented or unmounted without resetting its browsing context — a full workbench reload (Blink refuses even `moveBefore` on frame elements, per `25b2d667fa`'s commit body) — and session-scoped slot bodies remount on every session switch while the workbench belongs to the workspace. What was accidental was the custody model built from that fact (keyed records, `MAX_TWIN_FRAMES = 2`, park/evict) and the geometry model (escape the layout, then track it).

## Decision

**One iframe, owned once at root lifetime, placed by the layout.**

- `ui-layout` declares the `shell.ide` positional seat (`single`, root scope — no new scope kind was needed; every layout seat was already root-scope). AppFrame renders `.ideLayer` inside the rightbar column in the panel's own coordinates — same edge anchor, same slide, same fullscreen presentation — and owns its geometry through the frame's dataset (`data-rightbar-shown`, `data-rightbar-swapped`, `data-rightbar-fullscreen`) plus a width prop mirroring the panel solve. The layer sits in the content band (document order after the panel), always `pointer-events: none`; the occupant opts its content back in.
- `ui-vscode` registers `TwinFrame`: exactly one `<iframe>` created once and never removed. Session-bound vscode bodies publish their workspace's ready src through the intent store (`publishTwinIntent` / `useTwinIntent`, owner-token releases so a stale unmount cannot blank a live publisher, later publishers win). A null intent only hides the layer (`display: none`) — it never re-points the frame — and a src change assigns `frame.src` exactly once. The boot cover seals each fresh document in the seat until `load` plus the 1200 ms settle margin.
- `VscodeBody` keeps the poll, the readiness lines, and the boot hero in the pane for not-ready states; once ready it only publishes and renders nothing.
- `ui-sidebar-right` publishes `data-vscode-mounted` from its own `vsMounted` state, replacing the `.panel:has([data-twin-stake])` surface punch.
- The z band now lives in `ui-theme`'s `--dsh-z-*` tokens (panel/ide in the content band at 10, handle and panel chrome at 11, shell overlay 20, panel fullscreen 40, fullscreen IDE 45, float host 60), consumed by the frame CSS and the sidebar-right CSS; no package mints its own literal again.
- The independent handle bug landed with the change: the swapped-branch formula gains the second `FRAME_GAP` term it was missing, so the handle strip centers in the inter-card gap in both orders.

Deleted with the float design: the `twins` record store, `MAX_TWIN_FRAMES` parking and eviction, the `document.body` portal, the 16 ms `place()` loop, `FLOAT_Z`/`FLOAT_Z_FULLSCREEN` and the per-tick `closest()` band check, `data-twin-stake`, and the portal-into-portal boot cover. `keep-alive.tsx` is gone; `twin.tsx` is its whole replacement.

## Registration and mounting, before and after

Before (float design):

```
session scope: sidebar.right.pane.tab → VscodeBody → <div data-twin-stake>   (placeholder only)
root scope:    shell.overlay        → TwinFrameHost → portal → document.body<div data-twin-float>
                                        └─ 16 ms loop: stake rect → container left/top/w/h
                                           keyed records, ≤2 live frames, park/evict, hand-tuned z bands
```

After (this decision):

```
root scope, positional seat: shell.ide (ui-layout, .ideLayer in the rightbar column)
  └─ ui-vscode TwinFrame — mounted once
       └─ exactly one <iframe>, src = the active body's published ready triple
session scope: sidebar.right.pane.tab → VscodeBody keeps polling, copies, and src publication
```

## Alternatives considered

**Workspace-keyed multi-frame positional seat** (keep parked instant-restore by adding a workspace-persistent scope kind to the slot system): rejected — it preserves instant workspace switching at the price of a new persistence concept every slot consumer must reason about, N live workbench documents, and the entire record-store/eviction layer; the usage pattern that would pay for it (rapid workspace flipping) is unproven, and the singleton can grow keying later if measurement demands it.

**Keep the float, harden the machinery** (ResizeObserver instead of the 16 ms loop, more z literals, wider handle hit tests): rejected — every future layout feature kept paying the per-feature renegotiation tax the float's first three days demonstrated; an observer keeps geometry derived instead of owned.

**Render the iframe inline in the session-scoped pane with no keep-alive**: rejected — remounting on session *selection* (including switching back and forth on one workspace) would reload the workbench constantly; root lifetime is what makes the single frame cheap.

**Reparent the iframe between hosts on session switch**: rejected — browsers reset the browsing context on reparent.

**A bespoke persistence channel** (ui-vscode ↔ AppFrame private contract): rejected — duplicates what the slot registry already models (registration, root scope, render position) with none of its discipline.

## Consequences

**Bought:** geometry, resize, fullscreen, and glass returned to the layout system, expressed in its own coordinates; the divider is draggable with the twin open by structure (content band 10 below the chrome band 11), not by negotiated z-order; one iframe instead of a capped live set, with the record store, polling loop, portals, and magic numbers deleted; the regression surface named above is gone rather than patched at the newest instance.

**Cost:** switching workspaces navigates the single iframe to that workspace's twin — a full workbench boot instead of the parked-frame instant restore the float bought. `pickStablePort` keeps each workspace's loopback port — and therefore origin — stable, so each workspace's own origin-keyed IndexedDB restores its editors and layout on return; in-flight unsaved state rides vscode-web's hot-exit semantics, as it already did across harness restarts. The twin's connection token still is not persisted across harness restarts (the float-era note recorded the same choice: a process-scoped secret on disk buys marginal gain over the IndexedDB restore). If workspace flipping proves a daily pattern, the singleton's src-keying is forward-compatible with growing a second frame; this note records that keying was sacrificed deliberately, not lost.

Server-side custody is unchanged and remains the sibling decision: `@deepseek-ai/dsh-api-ide` keys one twin process per workspace root, and the client mirrors it at exactly one document per workspace session.

## Testing

- `packages/client/ui-vscode/tests/vscode-twin.client.spec.tsx` — singleton custody (one element across remounts and workspace switches), intent ownership (stale releases cannot blank live publishers), in-seat containment (no body portal, no rect tracking), and the boot-cover settle lifecycle.
- `packages/client/ui-layout/tests/app-frame.client.spec.tsx` — handle strip centered in the inter-card gap in both orders, and the IDE layer mirroring panel width and fullscreen span.
- `packages/client/ui-layout/tests/apply.client.spec.ts` — the five root-scoped seat declarations including `shell.ide`.

## Related

- [Embedded OSS-VS-Code editor frame](../../proposed/architecture/2026-10-09-embedded-vscode-reh-editor-frame.md) — the effort this row belongs to.
- [A parked spare twin frame for cheap workspace switching](../feature/2026-10-13-parked-spare-twin-frame.md) — amends this decision's custody claim (one visible frame, at most one parked spare) after measured flip pain; geometry and registration stand.
- `packages/api/ide/src/index.ts` — the unchanged workspace-keyed twin server registry the client mirrors.
- Supersedes and consolidates the deleted keep-alive note (*Workspace-keyed keep-alive float for the VS Code twin*, 2026-10-12): its surviving rationale — the reparenting trap, the never-move-the-element rule, the boot-cover anti-flash seam, the non-persisted connection token — is recorded where this decision now owns it (above).
