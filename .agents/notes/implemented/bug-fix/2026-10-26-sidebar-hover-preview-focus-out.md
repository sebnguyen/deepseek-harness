# Agent Note: A hover-open sidebar keeps its preview when a session click moves focus

Status: implemented

## Problem

On a collapsed sidebar — a frame below the 1024px breakpoint or a rail the
user closed — the panel opens as a hover preview while the pointer rests on the
rail. Opening any session closed it: the panel slid back to the rail although
the pointer never left.

A session click calls `openSession`, which bumps the activation store
(`packages/client/ui-workspace/src/client/navigation.ts:155-162`); the
conversation refocuses its composer on every activation gesture
(`packages/client/ui-conversation/src/client/apply.ts:216-238`). That focus
move blurs whatever held focus inside the sidebar — the "Show N more
sessions" button that revealed the clicked row, or the search field — and the
shell treated every blur that left the column as the user leaving, clearing
`hovered`. The shell's own rule is that the preview closes when the pointer
**and** focus have left; the pointer-leave handler checks focus, but the blur
handler never checked the pointer. The "show more" correlation was
incidental: that button was the focused control at the moment the revealed row
was clicked.

## Decision

`SidebarRoot` tracks raw pointer presence in a `pointerOver` ref
(`packages/client/ui-sidebar/src/client/SidebarRoot.tsx:162-165`) and its blur
handler (`SidebarRoot.tsx:300-307`) returns while the pointer still rests in
the column. The pointer-leave handler keeps its focus check, so each
departure is ignored while the other presence still holds the preview. `pointerOver` is deliberately separate from
the scrollbar's `pointerInside` state: that state lingers for
`SCROLLBAR_LINGER_MS` after the pointer leaves, and a blur inside that window
must not keep a preview alive after the user has tabbed out.

## Alternatives considered

- **Make session rows focusable with `tabIndex`.** A focused row would keep
the blur inside the column for this one click target, but search results and
workspace headers share the same exposure, and the change would add every row
to the tab order.
- **Ignore a `focusout` whose `relatedTarget` is null.** A click on a
non-focusable row blurs to the page, so this hides the reported symptom, but
it also ignores a click on the page after the pointer had already left, and
the preview would never close.
- **Stop the composer from refocusing on a sidebar-initiated activation.**
That focus is the conversation's deliberate behavior for every activation
gesture, including reselecting the current session; the preview's own close
rule is what misread it.

## Consequences

- A hover preview stays open when a click inside it moves focus to the
conversation (or to the page); it closes when the pointer leaves with focus
outside, or when focus leaves with the pointer already outside.
- A keyboard user tabbing out while the pointer rests over the column keeps
the preview open — the pointer still holds it, which is the documented rule.
- Opening a session revealed by "Show more" no longer collapses the panel
under the pointer.

## Related

- [A session drag no longer retracts the sidebar's hover preview](2026-10-26-sidebar-hover-preview-drag.md)

## Testing

`packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` pins both
halves: a `focusout` to the page while the pointer is inside keeps the shell
wide, and a `focusout` after `pointerleave` settles back to the rail. The
first fails without the pointer guard; both pass with it. The changed client
graph typechecks with `pnpm exec tsc -b tsconfig.client.json`.
