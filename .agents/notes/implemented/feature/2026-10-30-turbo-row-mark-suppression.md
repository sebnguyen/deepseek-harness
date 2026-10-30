# Agent Note: Turbo suppresses PCE row pixel marks

Status: implemented

## Problem

Turbo mounts one full ChatView per cell. Every chat row renders the shared `PceRow` chrome, and each row's leading 16px `PixelGlyph` plus its trailing state glyph or loader account for most of the DOM: the chat-window bench measures 3,364 of 3,853 window elements (87.3%) as SVG `<rect>` cells, and a running `PixelLoader` mounts in 3.5–6.8 ms. A Turbo window multiplies that per-row cost by its concurrent chats, so the decorative marks compete with the transcript before the grid is useful.

## Decision

`PceRow` takes a `marks` prop (default true). False renders neither the leading kind glyph nor the trailing state mark or loader; the localized state label stays for assistive technology. `ChatNodeOwnerProps` carries `rowMarks`, and `ToolCallOwnerProps` forwards it, so every chat-node renderer and atomic tool view reaches the flag without reading the service again. `ChatView` reads the optional `useLayoutMode` root hook once, computes `rowMarks = layoutMode.phase !== 'active' || layoutMode.mode === 'default'`, and passes it through `ChatNodeSeat`; `ToolCallTree` forwards the owner value to its subcall row and to each keyed tool view. `GoalCommandInputView` consumes the same owner value. The default shell leaves every mark in place, and an absent hook (a composition without `ui-layout-mode`) keeps the marks.

## Alternatives considered

**CSS-only hide.** A selector keyed off the existing `data-layout-mode` attribute would remove paint and layout, but React would still create the glyph SVG and its 50–158 `<rect>` children per row, so the DOM and mount cost that dominate Turbo would remain.

**Suppress only the leading kind glyph.** It is the larger static DOM share, but running rows keep the 116-rect animated `PixelLoader`, which is the most expensive single row element. Suppressing both marks addresses that cost as well.

**A React context in `ui-primitives`.** A provider could wrap the mode layer and let `PceRow` read the flag without threading. The client slot rules require components to receive data through the four props shares and keep React contexts renderer-internal, so the owner flag is the supported channel.

## Consequences

Turbo rows lose their kind colour cue and their per-row state mark; the row's title, summary, time, and state text remain. A row's trailing state is no longer visible at a glance in the grid, which is acceptable because the composer sweep and the turn tail carry the running signal. The default shell is unchanged. The flag is an optional owner field, so third-party chat-node and tool-view registrants keep working without changes; a registrant that ignores it simply keeps the marks.

## Testing

Focused client suites assert that both marks render by default, both disappear with `marks={false}`, and the layout-mode flag reaches a chat row through `ChatView`, a tool row through `ToolCallTree`, and the `/goal` row through `GoalCommandInputView`.

## Related

- [Turbo Mode — a per-window layout choice and a chat-cell grid](2026-10-28-turbo-mode-chat-grid.md)
