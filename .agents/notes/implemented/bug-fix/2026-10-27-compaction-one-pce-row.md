# Agent Note: Context compaction renders as one pce row

Status: implemented

## Problem

The pce port wrapped the legacy compaction marker instead of porting it. `CompactionNodeView` and `ManualCompactionNodeView` each rendered a non-collapsible `PceRow` whose body was the old `CompactionItem` button row, so the marker painted two heads: the outer pce head carrying the `folder-close` or `copy` glyph and the label, then an inner 24px button repeating the label beside the item/token counts. Only the inner row owned the summary disclosure, so the affordance that opens the summary sat one row below the row that names it. The manual `/compact` transaction nested the same pair inside its command wrapper.

## Decision

Both compaction kinds are one `PceRow` in `packages/client/ui-chat/src/client/chat/CompactionItem.tsx`. The head is the disclosure: the collapsed line carries the localized label and the summary, and the expanded body carries the cited summary through `MarkdownText`.

- The automatic marker keeps `kind="compaction"`, glyph `folder-close`, and state `ok`; the manual transaction uses `kind="manual-compaction"`, glyph `copy`, and mirrors its command's outcome (`running` / `ok` / `error`).
- The collapsed summary is the shadowed item/token counts when both are known, otherwise the command settlement text, otherwise the localized expand/unavailable copy — the same precedence the old marker used.
- `body` is `null` when the loaded window does not include the cited summary. `PceRow` then renders no toggle and no body, which is the old disabled-button state without a disabled control.
- `ManualCompactionNodeView` renders `CompactionCommandCard` directly. A `/compact` without a correlated checkpoint still falls back to `GenericCommandCard`, whose settlement text and error state are unchanged.
- The legacy `compactionRow` / `compactionButton` / leading-icon / disclosure-icon / title / separator / summary CSS and its `_compactionButton` override in `apps/web/public/atlas.css` are deleted.

## Alternatives considered

- **Keep the outer pce wrapper and delete only the inner head.** The disclosure would then have to be moved onto the outer non-collapsible head, which is the same edit plus a leftover body wrapper; the wrapper also forced the article to be always-open.
- **Keep the legacy marker and drop the outer pce row.** That loses the pce mark, kind colour and command state from the marker, and leaves compaction as the one chat kind outside the shared row chrome.
- **Render the summary Markdown inside the collapsed head.** The head is a single truncating line; a multi-paragraph summary cannot live there, and the existing design puts prose in the body behind the toggle.
- **Give the automatic and manual markers separate row components.** They differ only in kind, glyph, state and label precedence, all of which are props on the shared row.

## Consequences

The transcript now shows one row per compaction event: one label, one counts line, one toggle, then the Markdown summary. A manual `/compact` row stays `/compact`-labelled through running to completion, and the marker drops from two stacked rows to one. The old test hooks (`data-compaction-icon`, `data-compaction-disclosure`) are gone; the row is addressed by `data-pce="compaction"` / `data-pce="manual-compaction"` and the head's `aria-expanded`.

## Testing

- `pnpm vitest run --config vitest.config.ts packages/client/ui-chat/tests/chat-view.client.spec.tsx -t compact` passes three tests: the `/compact` lifecycle, the no-history/error generic fallback, and the automatic marker. The two marker tests assert the head itself carries `pce-head` and `aria-expanded`, which failed against the nested placeholder before the change.
- `pnpm exec tsc --noEmit -p packages/client/ui-chat/tsconfig.json` passes.
- The same chat-view file still has three pre-existing failures unrelated to compaction (`textContent` reads `svg[data-glyph]` CSS text in the turn-error, max-tokens and settled-footer tests); they fail identically without this change.
