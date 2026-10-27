# Agent Note: collapsed chat bodies mount on expand

Status: implemented

## Problem

`PceRow` supports `keepMounted`, which renders a collapsed body into the
document and marks it `hidden="until-found"` from a ref callback. Two costs
came with it:

- The body is built at mount, not on expand, so a transcript with 60+ reasoning
  rows pays to construct every reasoning body it will never show. With the live
  band at 100 that cost is paid again on every remount.
- `hidden="until-found"` keeps the element's box in layout
  (`content-visibility: hidden` hides the content, not the padding). A collapsed
  body therefore still contributed its box until `PceRow.css` zeroed its
  padding, and the attribute itself only exists after the ref runs — the body is
  laid out expanded before it collapses.

The feature bought exactly one thing: browser find-in-page could reach text
inside a collapsed row.

## Decision

Stop passing `keepMounted` for the kinds whose body is expensive, so the body is
built only while expanded:

| row | body | policy |
|---|---|---|
| reasoning | plain text, one per step | mount on expand |
| context injection | opaque/recalled material, can be large | mount on expand |
| system prompt | the whole system prompt | mount on expand |
| unknown node | JSON block | mount on expand |
| model retry | two short lines | keep mounted |

The prop stays on `PceRow`; the retry row keeps it because its body is two lines
and reads as inline status, not as content.

## Alternatives considered

**Pre-hide the body in JSX** with `style={{ contentVisibility: 'hidden' }}` so
the first paint is already collapsed, and let the ref upgrade it to
`hidden="until-found"`. This fixes the flash but keeps every collapsed body
constructed, which is the larger cost.

**Drop `keepMounted` everywhere**, including the retry row. The retry body is
too small for its removal to matter, and keeping it mounted preserves find while
a retry is active.

**Render `hidden="until-found"` declaratively.** React 18 treats `hidden` as a
boolean DOM property, so JSX renders `hidden=""`, not the `until-found` value;
that is why the attribute is set imperatively at all.

## Consequences

Browser find no longer reaches the reasoning, context, system-prompt, or unknown
bodies while those rows are collapsed, and expanding a row is the only way to
build its body. Specs that asserted a mounted, hidden body now assert the body
is absent until the row expands.

## Related

- [A viewport-sized live band for the chat row window](2026-10-26-chat-row-window-band-100.md)
- [A dormant chat row reserves its content box, not its padded box](../bug-fix/2026-10-26-dormant-row-spacer-double-padding.md)
