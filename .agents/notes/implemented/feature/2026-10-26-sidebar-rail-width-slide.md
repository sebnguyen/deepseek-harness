# Agent Note: the left sidebar slides its rail-to-panel width

Status: implemented

## Problem

The left sidebar's rail and expanded panel are two widths of one floating element: `SidebarRoot` writes `width: 56px` when closed and the expanded width (never below the 264px minimum) when open. React swaps that inline value in one commit, so opening — by hovering the rail, clicking its mark, or crossing the responsive breakpoint — snapped the panel edge to its final width. The old slide lived in the frame's `grid-template-columns`; the panel now floats over a permanent 56px track, so no track motion moves it.

## Decision

`SidebarRoot` animates its own width with the Web Animations API. A `useLayoutEffect` compares the current fold (`open`, `collapsed`) with the previous render and, on a fold flip, cancels any running slide, starts from the previously shown width (or the rendered edge when a slide is already running), and calls `element.animate([{ width: from }, { width: to }], { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' })`. The duration and curve mirror `--ds-transition-duration-slow` and `--ds-ease-in-out` in `packages/client/ui-theme/src/styles/base.css`.

React keeps the inline style at the target; the animation's cascade override carries the edge until it finishes, so the handoff has no jump. A width change with the fold state held — a pointer drag on the resize handle, or a width prop update — writes the inline width directly and cancels a running slide, keeping the panel edge on the handle. `prefers-reduced-motion: reduce`, a DOM without `Element.animate`, and a fold flip whose start equals the target render the target width immediately. Unmounting the shell cancels the active animation.

The 150ms wide-content fade and rail settle do not change: the 300ms width slide brackets that settle, the expanded content enters while the panel grows, and the rail content enters at the settle while the panel finishes closing.

## Alternatives considered

**A CSS `transition: width` on the root.** The smallest change, but a transition applies to every inline width write, including drag frames, so it needs the same fold gate plus a drag flag; the Web Animations API makes the fold change the trigger and lets the drag path opt out naturally. The requested motion API also pointed at WAAPI rather than a transition.

**Add the `motion` library (framer-motion) for the width animation.** Rejected: a new runtime dependency, dependency-policy and build-face work, and bundle weight for one width tween; the browser baseline that runs React 18 already provides WAAPI.

**Animate `transform: scaleX()` on a wrapper instead of width.** Rejected: it scales the panel's contents with the box, so labels and icons would stretch during the slide.

**Keep the track animation.** Rejected: the frame's sidebar track is permanently `SIDEBAR_COLLAPSED` because the expanded panel floats over the centre, so `grid-template-columns` has nothing to animate.

## Consequences

- Expansion and collapse both ease in and out over 300ms; hover expansion, a pinned open, and the responsive fold use the same path.
- A hover preview opens to the 264px minimum until the fold is pinned, which restores the stored width; the pin from a preview is itself a 264-to-stored-width slide.
- Pointer drags stay direct, and grabbing during a slide takes the edge back at the handle's base width.
- The width animation overrides the inline style only while it plays; the finished animation has no fill, so the target width is the resting style.
- The two timing constants are TypeScript values rather than CSS custom properties because `Element.animate` takes numbers and strings; their comments name the theme tokens they mirror.

## Testing

`packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` stubs `Element.prototype.animate` and pins the open (`56px` to `300px`) and close keyframes with the 300ms ease-in-out timing, the reduced-motion short circuit, both sides of the matches check, reversal from a measured mid-slide edge, direct pointer-drag width writes, the hover-preview pin no-op, and the unmount cancel. The built web app was observed in Chromium: hover produced `56px` to `264px` and pointer leave produced `264px` to `56px`, both at 300ms with intermediate widths sampled across the slide.
