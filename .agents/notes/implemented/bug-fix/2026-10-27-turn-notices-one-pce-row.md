# Agent Note: Turn notices render once, and pixel glyphs add no text

Status: implemented

## Problem

The pce port wrapped the two turn notices instead of porting them. `TurnErrorItem` and `TurnMaxTokensItem` each rendered a `PceRow` head carrying the title and the message, then kept the legacy `role="status"` row as the always-open body — the same dot, title, message and code again. A failed turn therefore painted twice: `This turn failed · Connection error.` in the head, then the legacy red card below it repeating the title and message with the provider code. The atlas theme's `_turnErrorRow` / `_turnErrorTitle` rules still targeted the legacy card, so the duplicate was also the element that looked designed.

A second source of stray text sat under every pce row. `PixelGlyph` emitted a per-instance `<style>` element carrying the cell-gap rule (`svg[data-glyph] rect{clip-path:inset(10%)}`). The rule is document-global, so the page carried one copy per glyph, and every element containing a glyph reported that CSS text through `textContent` — including the turn-notice status regions. The three failures in `chat-view.client.spec.tsx` (turn error, max tokens, settled footer) were that text, not the notice layout.

## Decision

`TurnErrorItem` and `TurnMaxTokensItem` are one `PceRow` inside a `<div role="status">` wrapper: the head carries `title`, `summary`, state, and — for a turn error — the provider code in the `suffix` slot. `body` is `null`, so no always-open second row exists. The legacy `.turnErrorRow` / `.turnErrorDot` / `.turnErrorCopy` / `.turnErrorTitle` / `.turnErrorMessage` / `.turnErrorCode` / `.maxTokensTitle` module rules and the atlas `_turnErrorRow` / `_turnErrorTitle` overrides are deleted; the `StateDot` import is gone with them.

The glyph gap moves from the inline `<style>` to `packages/client/ui-primitives/src/PixelGlyph.css`, a global rule on `svg[data-glyph] rect`. `PixelGlyph` no longer emits the `<style>` element; the generated catalog's `PIXEL_SYMBOL_GAP_CSS` constant stays as catalog data for the design tooling. `PceRow` also drops its `aria-label` of `${title} redesigned chat element`, a label copied from the design gallery that named every production row a redesigned chat element.

## Alternatives considered

- **Keep the legacy status row and drop the pce head.** That is the pre-port layout: it loses the kind glyph, kind colour and state cell, and leaves turn notices as the only chat kinds outside the shared row chrome.
- **Keep the head and make the body a visually-hidden status sentence.** The row text would exist twice in the DOM again — exactly the duplication the change removes — and a live region that only repeats visible content is one announcement nobody needs.
- **Put the provider code in the summary string instead of the suffix.** The summary truncates against the row, so a diagnostic tag would disappear behind the ellipsis; the suffix slot is the row's non-truncating trailing cell.
- **Keep one `<style>` per glyph but hide it from `textContent`.** A `<style>` element is text by definition; the only way to keep it out of the text is to stop emitting it. The global rule is also one copy instead of one per glyph.
- **Keep the gallery `aria-label` on the pce article.** It is not a user-facing name; the head already names the row, and the label made screen readers hear “redesigned chat element” on every row.

## Consequences

A failed turn and a max-tokens turn each render one head and one announcement. The error code stays visible as the row's trailing mono cell, and the atlas red card no longer competes with the pce head. The transcript's text content contains no glyph CSS; the three previously failing `chat-view.client.spec.tsx` cases now pass with the interpunct the pce head actually renders between title and description.

## Testing

- `pnpm vitest run --config vitest.config.ts packages/client/ui-chat/tests` — 381 passed (the turn-error, max-tokens, settled-footer, compaction branch and font-axis cases included).
- `pnpm vitest run --config vitest.config.ts packages/client/ui-chat/tests/pce-glyph-coverage.client.spec.tsx` — passes; every catalog symbol is still covered.
- `pnpm exec tsc --noEmit -p packages/client/ui-chat/tsconfig.json` and `-p packages/client/ui-primitives/tsconfig.json` — both clean.
- Two `ui-primitives` tests fail with or without this change (`icons.client.spec.tsx` expects 79 exports and finds 80; `tag-styles.client.spec.ts` expects `border-radius: 999px` in `Tag.module.css`); they are not touched here.
