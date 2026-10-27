# Agent Note: The twin gates its own focus; the host keeps no guard

Status: implemented

## Problem

The workspace twin's iframe took the keyboard from the composer on every boot
and reload. The restored editor focuses itself at load + 250–375 ms, and
focusing inside an iframe promotes browser focus to the `<iframe>` element.
The host page is cross-origin from the workbench, so it cannot see a click and
can only guess intent after a window blur. Successive host-side guards
(boot-cover denial, `coveredRef`, `relatedTarget` filtering) each closed one
guess and left another: a synthetic `pointerover` fired when the boot cover
lifts under a resting cursor, a verified hold surviving a source change, and a
late restore after the cover lifted.

The decisive measurement: `inert` on the iframe does **not** stop promotion.
With `inert` set, the child's `focus()` still made the parent report
`activeElement=IFRAME` and blur its composer. No host-side attribute or event
handler can prevent a loaded browsing context from taking browser focus. The
only layer that can is the frame's own document.

## Decision

The embedded workbench gates its own programmatic focus before the workbench
scripts run (`src/vs/code/browser/workbench/workbench.html`, and the dev
template). When `window.parent !== window`, it suppresses
`HTMLElement.prototype.focus` and `window.focus` until a trusted `pointerdown`,
`keydown`, or `wheel` lands inside the frame. The first click still focuses the
clicked element through the browser's default action; after that gesture the
native methods run unchanged, so the gate is a boot-window gate, not a
permanent monkeypatch. Top-level workbench tabs are untouched.

With the cause removed, the entire host guard is deleted in both DSH
checkouts: `lastFocus`, `frameHolds`/`frameHolder`, `frameHover`, `frameTabAt`,
`coveredRef`, the blur/pointer/key listeners, the parking focus hand-back, and
their specs. The boot cover remains anti-flash only.

## Alternatives considered

- **`inert` the iframe while the composer has focus.** Measured: does not block
  focus promotion; would also need a two-click activation shield.
- **Keep the host guard as defense-in-depth.** The guard is the patch cycle;
  keeping it reintroduces the guesses the gate deletes.
- **Patch the specific workbench restore call.** Narrower than the pre-boot
  gate but spread across editor layout/restore code and still one rebuild; the
  page-level gate is one inert block that covers every programmatic focus path.

## Consequences

- Boot and reload can no longer hand the keyboard to the workbench; the
  composer keeps it without a flicker.
- The first click into the pane enters the frame normally. A focus move caused
  by Tab alone does not arm the gate; the first keydown inside does, so the
  workbench may wait one keystroke before its own focus bookkeeping runs.
- The host no longer needs to know where focus was or whether a grab was user
  intent.
- The client change depends on a rebuilt twin from the fork; until that dist
  ships, an old twin still steals focus.

## Testing

- Playwright, two origins: boot `window.focus()` and `element.focus()` both log
  `SUPPRESSED`; the parent stays on `INPUT` with no window blur. A real click
  logs `ARMED pointerdown` and the parent's active element becomes `IFRAME`.
- `pnpm run vscode:twin` rebuilds the fork; verify the dist workbench HTML
  carries the gate before shipping the client guard deletion.
- `packages/client/ui-vscode/tests/vscode-twin.client.spec.tsx` passes without
  the guard cases; the boot-cover anti-flash cases remain.
