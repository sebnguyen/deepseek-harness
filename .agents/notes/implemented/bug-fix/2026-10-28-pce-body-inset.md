# Agent Note: the expanded pce body keeps an internal vertical inset

Status: implemented

## Problem

An expandable pce row draws its head line and then places the caller's body
flush against it. The body cards carry no vertical margin of their own — the
port zeroed them so a card could never add space below its row — so an expanded
read, diff, terminal or search box touched the head's hairline above and the
next flow row's top below. The collapsed row is one line on a 6px flow rhythm;
the expanded row read as a single unbroken block.

## Decision

The expanded body carries an 8px top and bottom margin, so every expanded pce
body keeps the same internal inset regardless of which card the caller renders.
The margin lives on the body wrapper, not on the cards: a body may stack several
cards (frames, search plus recovery notice), and the row's spacing must not
depend on how many the tool produced. It is scoped to
`.pce-body[data-pce-expanded]`, the marker PceRow renders only in its open
branch, so a collapsed keepMounted body never carries the inset even while its
box is still in the document.

The flow array's 6px gap remains the only space between rows, and the body's
own boundary is where the row ends. The hidden reset also zeroes margin and
padding (in `PceRow.css` and in the atlas override) as a second guard, because
`content-visibility: hidden` leaves the element's box in layout.

## Alternatives considered

- **Put the 8px on each body card (`margin: 4px 0 0` or `8px 0`).** The tool
  cards are one family of many callers; a wrapper rule covers read, diff,
  terminal, search, web, todo, ask, image, frames and chat bodies without each
  card opting in, and it cannot double when a body stacks cards.
- **Use padding on `.pce-body`.** It renders identically at rest, but padding
  belongs to the body box; the requested space is between the head and the
  body and between the body and the row's end, which is margin.
- **Rely on `.pce-body[hidden]` alone.** That is the earlier attempt; the
  collapsed body is mounted before the attribute is set, and a consumer that
  renders the body box without `hidden` would pick the margin up. The expanded
  marker makes the inset a property of the open render, not of the attribute's
  timing.
- **Keep the body flush and let the flow gap separate the next row.** That is
  the shipped port behavior; it leaves the expanded card touching the head
  hairline, which is the defect this note records.

## Consequences

An expanded pce row now has 8px of air above and below its body, so the head
hairline, the expanded card and the next row read as three separate bands. The
collapsed row is unchanged: no body means no inset, and a declined or dormant
row still contributes no box. The cost is 16px of row height per expanded row;
because the row window measures rendered rows, the extra height is measured
rather than assumed.

## Testing

- `packages/client/ui-primitives/tests/pce-row-styles.client.spec.ts` pins the
  wrapper margin and the hidden reset in the stylesheet.
- Chromium against the shipped `PceRow.css` and `atlas.css`: an expanded body
  computes `margin-top: 8px` / `margin-bottom: 8px`, its top edge sits 8px below
  the head's bottom edge, the next row starts 6px below the body's margin box,
  and a collapsed keepMounted body with and without `hidden="until-found"`
  computes zero margin and contributes no height.

## Related

- [One 8px rhythm for transcript rows](../simplification/2026-10-26-chat-row-spacing-8px.md)
  — the flow gap this internal inset sits inside.
