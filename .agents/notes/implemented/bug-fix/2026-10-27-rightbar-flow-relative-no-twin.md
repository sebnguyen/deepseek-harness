# Right Sidebar: flow-relative panel and no-twin surface gate

## Problem

Two independent defects kept the right Sidebar looking broken across session switches.

1. `ui-vscode` auto-opened its surface tab on every session adoption without asking whether a twin existed. In a deployment with no twin, the auto-opened tab elected the vscode surface, so the column showed the "no VS Code twin configured" body instead of the dockkit guide and its chrome. The surface stayed materialized while the session's rightbar was collapsed, so switching back to that session reopened onto the stale surface/iframe. This is the "rightsidebar that mounts the session-scope iframe is still there" report and the reason a remembered-collapsed session reopened wrong.
2. The twin body host was `position: absolute; inset: 0` inside the dock row, and the panel was `position: absolute; top/right/bottom: 0` inside the right column. Both were containment-only absolutes: the host inside `.dockArea` and the panel inside the unmoving right column.
3. The panel's inline width stayed the preferred width even when its grid track was 0. In flow, that gave the collapsed panel a full-width box over the centre (translated off edge), still holding the session's surface and its twin iframe. The frame was `overflow: hidden`, hence a scroll container: mounting/focusing the iframe in a session whose rightbar was hidden scrolled the frame to the off-edge box. The whole shell shifted left (left sidebar off-screen, chat clipped at the left) and the vacated off-edge slab appeared as an empty middle; expanding the rightbar removed the overflow, clamped `scrollLeft` to 0, and showed the twin — the reported "viewport width magically increases, vscode comes back on toggle". The twin being enabled is what makes the iframe (and its focus) present.

The atlas theme also drew a `border-left` on the right column even when its track was 0 and on the fullscreen panel, producing a 1px column instead of 0 and a 1681px fullscreen box.

## Decision

- The vscode adoption hook now reads `ideBridge.status(sessionId).enabled` and only auto-opens the twin when a viable twin exists. A disabled bridge is the documented "no viable twin, no mount" deployment, so the column stays with the dockkit guide. The tab can still be opened manually through the ordinary path.
- The twin host is a flex item in the existing `.dockArea` flex row (`flex: 1 1 auto`, `min-width/min-height: 0`). It keeps `position: relative` solely so the boot cover's `inset: 0` resolves.
- `.rightbarCol` is a flex row and packs the fixed-width panel against its anchored edge: `justify-content: flex-end` normally, `flex-start` when swapped. `flex: none` keeps the panel width stable while the grid track animates; the panel overflows a zero-width column over the centre exactly as the old absolute anchor did. Fullscreen remains `position: fixed` because it must cover the viewport.
- Atlas: no right-column rule under `[data-rightbar-collapsed]`, and no left border on `[data-sidebar-right-panel='fullscreen']`.
- The frame clips instead of scrolling: `overflow: hidden; overflow: clip;`. `clip` keeps the same paint clipping without a scrollport, so a focused descendant of the hidden panel can never set a shell scroll offset. 
- The panel fills its slot instead of carrying the preferred width: `width: 100%`, capped by the preferred width (`maxWidth`) in normal presentation and uncapped in fullscreen. A collapsed track is 0, so the panel and the twin iframe have no box to overflow or scroll to; the iframe still fills the full slot when shown. This is the primary fix; the frame clip and panel inert below are guards for the close transient.
- The collapsed panel is `inert`: the panel's layout effect sets `inert` when `expanded` is false and removes it when expanded, so the mounted twin iframe is out of focus, tab order, and hit testing while off edge. `aria-hidden` already covered assistive tech; `inert` covers focus and scroll-into-view.

## Alternatives considered

- Keep the panel absolute and only change the twin host: leaves the reported containment and the stale-surface path in place; rejected.
- Make the panel `width: 100%` in flow: would resize it as the track animates and break the pinned right edge and slide; rejected.
- Keep the vscode auto-open unconditional and hide the fallback: the surface would still hide the dockkit tabs and still own the column while collapsed; rejected.

## Verification

- `pnpm exec vitest run packages/client/ui-vscode/tests` — 24 pass, including enabled and disabled adoption.
- `pnpm exec vitest run packages/client/ui-sidebar-right/tests/seat.client.spec.tsx` — 31 pass, including the panel filling its slot (`width: 100%`, preferred `maxWidth`, none in fullscreen), switching to a session whose remembered rightbar is collapsed, and the panel's `inert` attribute across that switch.
- `pnpm exec tsc -b tsconfig.client.json` — clean.
- `pnpm run build:lib:client` and `pnpm run build:web` — clean; the built CSS carries `overflow: clip` and the client bundle carries the `inert` write.
- Browser e2e (`apps/web/tests/sidebar-right.e2e.ts`): new assertions require the collapsed panel to be `inert` and the frame's `scrollLeft` to stay 0 after a programmatic nudge. The focused local run did not reach them because the developer profile opens a model-provider dialog over the page (the dialog intercepts the mode click before the collapse); the suite still carries pre-existing `ui-layout` store expectations (`swapped: true` while the store defaults false). Run the e2e in a clean profile to exercise the new assertions.
