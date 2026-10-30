# Agent Note: Turbo file opens use the Host desktop

Status: implemented

## Problem

Turbo renders the same conversation surface as the default shell but no
right-Sidebar column: `AppFrame` mounts the `rightbar` seat only while the
active mode is `default`
(`packages/client/ui-layout/src/client/AppFrame.tsx:246`). The Chat file
gestures nevertheless travel one `openFile` seam
(`packages/client/ui-chat/src/client/apply.ts`), which unconditionally called
`ctx.sidebarRight.openResource`. With no seat adopted, that service throws
`sidebarRight: no session surface is mounted`
(`packages/client/ui-sidebar-right/src/client/service.ts:516`): delivery cards,
read rows, snapshot chips, and prose mentions did not open their file in Turbo,
while the same gestures worked in the default shell.

## Decision

`openFile` reads the shell mode at gesture time through the optional
`layoutMode` service (absent means the default shell). While an active mode
other than `default` is pinned, it resolves the path with
`resolveWorkspacePath` and calls `session.openWorkspacePath` instead of
`sidebarRight.openResource`. That Remote opens the path with the Host's
default desktop application; the present card's chevron already used the same
Host opener through its verified delivery route. A relative path without a
Session `cwd` is refused with the ordinary file-open error rather than being
resolved against the Host process directory.

The default shell keeps the Sidebar path unchanged, including the `line` and
frozen-Changes navigation parameters. Those parameters are dropped in an
alternate shell because they name Sidebar-only destinations.

The delivery card's preview is Sidebar navigation, not a desktop gesture. In
an alternate shell the card drops its full-card preview button, its `Open`
button, and the `Preview in sidebar` hover hint, so a delivered file card
cannot become a second Host-desktop opener. The card's explicit chevron menu
keeps its verified `present.open` open/reveal actions, whose labels name the
desktop they act on.

## Alternatives considered

**Branch the delivery card only.** It would fix the most visible surface but
leave read rows, snapshot chips, and prose mentions broken in Turbo, and it
would duplicate the destination decision outside the one file-open seam.

**Catch the no-seat error and fall back to the desktop.** This hides wiring
mistakes and treats every absent seat as "use the desktop"; the shell mode is
the actual condition, so the guard belongs there.

**Give Turbo a right-Sidebar seat.** This contradicts Turbo's columnless
surface and would add a second presentation of the same conversation beside
the grid.

**Make the Host desktop the destination in every shell.** This loses the
in-product preview, the VS Code twin, and line navigation in the default
shell, where the Sidebar exists and is the intended destination.

## Consequences

Every file open in an alternate shell now depends on the Host desktop being
available; a headless or remote Host returns a Remote failure that the existing
Chat file-open dialog reports. Alternate-shell opens lose `line` and
`display: 'changes'` / `stop`, and they bypass `present.open`'s Session
filesystem and Host-path verification because the generic Remote takes a
resolved path rather than delivery coordinates. Direct
`ctx.sidebarRight.openResource` call sites outside this seam — the reference
browser and skill references — still require a right-Sidebar seat and remain
unavailable in Turbo; covering them needs a shared file-open service or their
own mode guard. The default shell is unchanged. The delivery card's preview
controls are absent in Turbo because the Sidebar gesture they perform is
absent; the chevron's desktop labels remain and match its actions.

## Testing

- `pnpm exec vitest run packages/client/ui-chat/tests` — 392 tests pass,
  including the new alternate-shell destination, dropped navigation, Host
  refusal, and no-workspace refusal cases.
- `pnpm exec tsc -b packages/client/ui-chat/tsconfig.json` — passes.
- `pnpm exec tsx scripts/run-oxlint.ts --config .oxlintrc.json` on the touched
  files reports only the two pre-existing errors in
  `apply-inject.client.spec.tsx` (an unnecessary TestRemote assertion) and
  `apply.ts` (`revealIn` unbound method); no new finding.
- `pnpm exec vitest run packages/client/ui-deliverables/tests` — 131 tests
  pass, including the alternate-shell card preview and the default-shell
  preview/button paths.
- `pnpm exec tsc -b packages/client/ui-deliverables/tsconfig.client.json` —
  passes.
- `pnpm exec tsx scripts/run-oxlint.ts --config .oxlintrc.json` on the touched
  deliverables files reports no findings.
