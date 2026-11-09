# Agent Note: Expanded pce bodies start on the description column

Status: implemented

## Problem

A pce row's head leads with the 16px kind mark and a fixed identity column, so the row's description begins right of the article edge. The expanded body was a block at the article edge: a Present row's recorded output, a context body, and every tool card started under the glyph while the summary they belong to started under the identity column. A collapsed row and its expansion therefore read as two different left margins.

## Decision

`PceRow` renders every body as a flex row with an empty `.pce-body-gutter` followed by a `.pce-body-content` wrapper. The gutter mirrors the head's leading cells, so the content starts on the description column: 16px mark + 8px gap + 9ch identity + 8px gap. A row without a summary aligns the body after the mark, and a marks-off row drops the mark cell; the four widths are selected by `data-pce-description` and `data-pce-marks="false"` on the article. The gutter measures its `9ch` in the identity's own code face and font-size axis, so the Settings font-size preference moves the head description and the body content together.

The vertical contract is unchanged: `.pce-body[data-pce-expanded]` keeps its 8px top and bottom margin, and a collapsed keepMounted body still zeroes its margin and padding. The body cards need no alignment rule of their own; the wrapper owns the column.

## Alternatives considered

- **Pad `.pce-body` with a literal `calc(16px + 8px + 9ch + 8px)`.** It would duplicate the identity width in the body's font, drift from the head when the font axis or marks change, and need branches outside the wrapper.
- **Move the mark and identity out of the head into leading flex cells.** The body would align without a gutter, but the head's click target would shrink and the head-child contract and its tests would change for a presentational fix.
- **Lay the article out as a grid and place the body in the description track.** The track's `ch` resolves against the article's font, not the identity's code face; a marks-off row also needs a second template. The flex gutter measures in the same font the identity uses and keeps the current DOM semantics.
- **Keep the body flush with the article edge.** That is the shipped defect this note records.

## Consequences

Every expanded pce body gains a left indent that matches its description column, or the identity column when the row carries no summary. Dense shells that suppress row marks keep the same alignment with the 16px mark cell removed. The body content is one wrapper deeper, so the direct-child margin reset moves from `.pce-body > *` to `.pce-body-content > *`; no body card changes. A collapsed keepMounted body still reserves no height even though its box is now a flex container.

## Testing

- `pnpm vitest run --config vitest.config.ts packages/client/ui-primitives/tests/pce-row.client.spec.tsx packages/client/ui-primitives/tests/pce-row-styles.client.spec.ts` — 14 passed.
- `pnpm run test:gui` — 5,991 passed, 28 failed, 1 skipped across 435 files; both PceRow specs pass. The failures are outside this diff's alignment surface: snapshot-store persistence/localStorage, a missing `ui-theme/src/styles/corner-shape.css`, icon-count and stylesheet lint, and the two ui-tool subcall label expectations for the interpunct removed by the preceding PCE row-chrome change.
- `pnpm exec tsc --noEmit -p packages/client/ui-primitives/tsconfig.json` — clean.
- Chromium against the live ChatView bench: context and retry rows compute `descLeft === contentLeft` at 108.390625px; system-prompt and command rows compute `identityLeft === contentLeft` at 41px; a marks-off row with a summary computes 67.390625px for both; a marks-off row without a summary computes 0 for both. A collapsed keepMounted retry body computes `display: flex`, `content-visibility: hidden`, height 0, and a 20px row.

## Related

- [the expanded pce body keeps an internal vertical inset](2026-10-28-pce-body-inset.md)
- [One 8px rhythm for transcript rows](../simplification/2026-10-26-chat-row-spacing-8px.md)
