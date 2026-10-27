# Agent Note: One 8px rhythm for transcript rows

Status: implemented

## Problem

The transcript's vertical spacing was declared per row kind in the design
layer (`apps/web/public/atlas.css`): prompts carried `padding: 20px 0`, answer
text carried `8px 0`, and the work ledger (reasoning, tool call, context,
system prompt, command) carried `3px 0`. Nothing enforced a single rhythm, so
two neighbouring rows disagreed about the gap between them. On top of that,
the tool body kept a legacy `margin: 4px 0` on every expanded card
(`_codeBody`, `_diffBody`, `_ioCard`, `_terminalBody`, `_detached`, ...), which
put a second offset under the last card of a write or tool-call row and made
those rows read as if they carried extra bottom margin.

A third source of confusion: the module stylesheet still shipped a
`--dsh-chat-flow-gap` sibling rule and a `turn-tail` override, while atlas set
the same variable to `0px`, so the module rule was dead weight that looked
authoritative.

## Decision

Spacing is now one property with one value, declared once in `atlas.css`:

```css
html body [data-dsh-shell] [data-chat-flow] > [data-chat-flow-kind] {
  margin: 0;
  padding-top: 0;
  padding-bottom: 8px;
}
```

Every flow row ends with exactly 8px and starts flush. Prompts keep their
20px top inset (the turn rule rides on it), and nothing
else sets vertical padding on a row. Body cards carry a leading offset only
(`margin: 4px 0 0`), so a card can never add space below its row. The module
`ChatView.module.css` no longer owns any inter-row spacing, and the dead gap
variable plus its `turn-tail` override are gone.

Zero-height declined rows are unaffected: `ChatNodeSeat` still drops
`paddingBlock` and `marginBottom` inline when it reserves no height.

One row kind drew its own bottom edge: a pce row puts a hairline under its head
line, and the head's `padding: 0 0 8px` stacked on the flow's 8px. Reasoning and
tool rows therefore sat ~9px lower than a plain answer line even after the flow
rhythm was single. The head's bottom padding is now `0`, so the hairline is the
row's visual bottom and the flow's 8px is the whole gap after it.

## Alternatives considered

- **Keep per-kind padding and only drop the card margin.** Fixes the symptom
  the report named but leaves three rhythms disagreeing at every kind
  boundary.
- **Put the 8px on the module's `.flowItem` as a margin.** atlas declares
  `margin: 0` on the kinds it styles with higher specificity, so the module
  rule silently loses; spacing has to be owned where the winning selector
  lives.
- **Keep `--dsh-chat-flow-gap` as the knob.** atlas already pinned it to
  `0px`, so it never reached the browser as a real gap.

## Consequences

- Row spacing is greppable: one rule, one value, no per-kind overrides.
- A new row kind inherits the rhythm automatically; it cannot accidentally
  ship its own offset.
- The prompt's 20px top inset is the single deliberate exception and is
  scoped to `user` / `steering`.
- Verified in the running app: 64 visible rows measured `padding-bottom: 8px`
  and `padding-top: 0px`; declined rows measured 0 in both.
- Verified by cascade: in a page that loads `atlas.css` plus the shipped
  `PceRow.css`, `.pce-head` computes `padding-bottom: 0px` and consecutive rows
  measure 8px apart from the previous row's last box.
