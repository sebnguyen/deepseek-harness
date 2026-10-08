# Agent Note: The readable measure caps the chat width axis, and the user row spans it

Status: implemented

## Problem

The shared content width axis capped at a fixed 920px, about 94 characters per line at the 14px content face — beyond the 45–75 characters-per-line measure typographic guidance keeps body text inside. The user bubble meanwhile capped at 70.2% of the column (the figma 525/748 share), so long prompts wrapped at a narrow sliver while the column itself was too wide to read.

## Decision

The axis default carries no magic pixel constant: the cap is the readable measure, 55 characters — a comfortable value inside the 45–75 band, chosen after the 66-character optimum still read wide in live review — at the content face's 0.56em average advance, `--dsh-chat-readable-cap: calc(var(--dsh-content-font-size, 14px) * 30.8)` on `ConversationRoot`'s `.root` (431px at the default size), and the default content width is the smaller of that cap and 64% of the live column (`min()` of the two). Font size and width are both CSS px, so the default holds its character count at any browser zoom and rides the Settings font-size axis. `ConversationRoot.tsx` mirrors the measure in `resolveContentWidth` (reading the same body inline variable ui-theme publishes). A dragged preference (`--dsh-chat-user-width`) replaces the default wholesale and is bounded only by the geometry — the 640px layout column minimum and the 176px width-handle budget — never by the measure: an explicit choice outranks the rule. The user row drops its 70.2% bubble cap: `.userRow` stretches across the whole column and the bubble always fills that width with left-aligned text, so every prompt reads at the transcript measure.

## Alternatives considered

**Keep magic pixel constants (the former 920px ceiling, the former 680px floor).** Rejected: px constants ignore the Settings font-size axis and name nothing physical; the only surviving px figures are chrome budgets — the 176px width-handle budget and the 640px layout column minimum — which name physical UI, not reading comfort.

**Cap at 66 or 75 characters.** Rejected in live review: both still produced wide lines and heavy horizontal eye travel for this product's dense mixed prose/code column; 55 characters narrows the travel while staying inside the band.

**Measure `ch` or a hidden probe element in JS.** Rejected: the axis is pure CSS between packages with no shared runtime owner; a documented 0.56em average-advance approximation is stable across the content face and scales with the Settings font-size axis for free.

**Cap only assistant prose, not the column.** Rejected: the column is the one axis every row already shares; per-row measures would reintroduce divergent widths the shared axis removed.

## Why 30.8×font-size

Typography references (e.g. [Wikipedia, Line length](https://en.wikipedia.org/wiki/Line_length); Baymard's readability research) converge on 45–75 characters per line; live review picked 55 as the comfortable value for this product's dense mixed prose/code column, and 55 × 0.56em (a proportional-face average advance) is 30.8em, with no px ceiling to dilute a larger font setting. The constant lives once per plane (CSS variable, JS mirror) with the derivation commented; prose rules out a shipped runtime value across the two packages.

## Verification

`skeleton.client.spec.tsx` re-pins the drag round-trip at the 431px cap (431 + 50 → 481) and adds a 17px-content-size case (cap 524, 524 + 60 → 584) covering the parsed-variable branch; `markdown-wide-table.e2e.ts`'s 748 value is a viewport split between "transcript wider than the column" and "narrower", still satisfied at the 431px column, with comments refreshed.

## Consequences

- Default transcript width is 431px (55 characters at the default face); the Settings font-size axis widens the readable column proportionally, with no px ceiling.
- Stored width preferences (`dsh.conversation.contentWidth`) are bounded only by the geometry (640px floor, column − 176px handle budget), so an explicit wide choice persists and displays as chosen; the readable measure governs the adaptive default alone.
- Assistant Markdown, tables, and the composer card all inherit the narrower axis unchanged; the wide-table breakout now has more spare width at wide viewports because the column shrank.
