# Agent Note: the right-Sidebar toggle survives a blank Session

Status: implemented

## Problem

`ConversationSessionHeader` hides its whole tree while a Session is blank
(`hideChrome`), because the hero owns the top of the column. The header's
`conversation.session.header.corner` seat went with it. That seat carries
`ui-sidebar-right`'s `SidebarToggle`, the only normal-mode close control for
the right Sidebar (`2026-10-25-sidebar-toggle-in-conversation-header.md`).

A blank Session can still own an open right Sidebar: `ui-vscode` seats its
twin page on session adoption, and the seat's remembered open choice starts
`expanded`. So switching from a normal Session to a new one left the
session-scoped VS Code iframe drawn on the right with no close control in the
conversation, and no toggle in the hero. The atlas sheet also forced the
hidden header's 64px box back on, so the hero carried an empty bar as well.

## Decision

The blank branch keeps the corner seat mounted as a sibling float instead of
leaving it out with the chrome:

- `ConversationSessionHeader` renders the hidden `<header>` and, beside it, a
  `.headerCornerFloat` that holds `renderSlot('conversation.session.header.corner')`.
  The float is outside the `aria-hidden` header, so the button stays in the
  accessibility tree, and it exists independently of the header box, so both
  the module's `display: none` and the atlas sheet's header rule leave it alone.
- `ConversationRoot.module.css` anchors the float where the full header's
  corner sits (`top: 10px; right: 12px`) and lifts it above the hero body.
- `apps/web/public/atlas.css` honors the module's hidden state with
  `[data-dsh-header][class*='_headerHidden'] { display: none; }`; the theme's
  `height: 64px` header rule otherwise wins on specificity and draws an empty
  bar above the hero.

The active header keeps the same corner seat; the toggle's label, store, and
click behavior are unchanged.

## Alternatives considered

- **Hide the right Sidebar entirely on a blank Session.** It removes the
  reachable-close problem by removing the open panel, but it reverses the
  deliberate adoption-time twin seating and the remembered open choice; a user
  who wants the IDE beside a fresh Session loses it.
- **Put the close control back on the panel in normal presentation.** The
  panel's chrome is covered while a surface owns the column, which is why the
  toggle moved to the conversation (the rejected alternative there).
- **Leave the atlas header visible.** The hero then carries a 64px empty bar
  with one control; the module's blank state already documents that the header
  gives up its column space.

## Consequences

- Switching to a blank Session keeps the right Sidebar's close control in the
  conversation column, in both the module and the atlas sheet.
- The hero no longer reserves a header bar in the atlas sheet.
- The toggle unmounts and remounts across the blank/active boundary with the
  rest of the corner seat; its state lives in the shared right-Sidebar store,
  so the control reads the same expanded/collapsed fact on either side.

## Testing

- `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` — the hero
  phase now asserts the corner seat is dispatched and its float is outside the
  hidden header.
- `pnpm exec vitest run packages/client/ui-conversation/tests/skeleton.client.spec.tsx`
- The existing `sidebar-toggle.client.spec.tsx` and `seat.client.spec.tsx`
  pin the toggle's labels and the panel's fullscreen-only close control.
