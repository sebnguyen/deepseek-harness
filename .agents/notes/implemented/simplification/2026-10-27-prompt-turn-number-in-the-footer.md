# Agent Note: The prompt footer owns the turn number

Status: implemented

## Problem

A sent prompt carried its turn number twice. The design layer numbered prompt rows with a CSS counter: `apps/web/public/atlas.css` reset `counter-reset: prompt` on the chat flow, incremented `counter-increment: prompt` on every `user` and `steering` row, and printed `counter(prompt, decimal-leading-zero)` through a `::before` positioned in the column's left gutter. The prompt's own footer states the same number (`message.turn`: `Turn - {turn}` in English, `回合 - {turn}` in Chinese), so the gutter repeated what the footer already said, in a second place and a second type style. The gutter number was the weaker of the two: a CSS counter counts the prompt rows the browser has rendered, so it renumbers when an older history page loads, and it says nothing about the recorded turn a prompt belongs to.

The prompt footer was also not always on screen. `packages/client/ui-chat/src/client/chat/MessageIconActions.module.css` set the actions row (clock, turn number, copy action) to `opacity: 0` for every user or steering row that had a later user or steering sibling, under `@media (hover: hover)`, and restored it on `:hover` and `:focus-within`. Only the newest prompt kept its footer without a gesture, so a reader who scrolled back to an earlier prompt saw no clock, no turn number, and no copy button until the pointer happened to rest on that row.

## Decision

One turn number per prompt, and it sits in the prompt's own footer. `apps/web/public/atlas.css` declares no `counter-reset`, no `counter-increment`, and no `::before` on the prompt rows: the column's left gutter carries no index, and the prompt footer is the only place a turn number appears.

Every message footer row is visible. `MessageIconActions.module.css` keeps no opacity rule and no flow sibling selector, so the footer of every prompt and every turn tail shows its clock, its turn number, and its actions at all times. The gate was pure CSS, so no component changed and no row moved: opacity already reserved the row's height, and removing the rule reveals the row that was always there.

## Alternatives considered

- **Keep the gutter index and drop the footer's turn number.** A reader would have to look away from the prompt to find the number, and the gutter's number is the rendered-row count rather than the recorded turn, so a page of older history renumbers the prompts above it.
- **Keep both numbers.** The two numbers can disagree, because the gutter counts rendered prompts and the footer names the recorded turn, and one of them is then wrong on screen.
- **Keep the hover gate and reveal the footer on focus only.** A reader scrolling a long transcript with the pointer parked on the scrollbar still sees no footer, and the copy action the footer carries has to be reachable.
- **Keep the newest-prompt-only rule and reveal on hover.** The prompt that most needs its metadata is the one the reader scrolled back to read.

## Consequences

- One turn number per prompt, in the prompt's footer, beside the clock and the copy action.
- Every prompt's copy action is reachable without hovering that prompt's row.
- The transcript's left gutter carries no prompt number; its inset still separates the column from the frame edge.
- `packages/client/ui-chat/tests/chat-font-axis-styles.client.spec.ts` pins that the footer module declares no opacity rule and no flow sibling selector.

## Testing

- The style spec passes: the footer module declares no `@media (hover: hover)` block, no `opacity: 0`, and no `:has(` sibling selector.
- Observed in Chromium against the shipped stylesheets, with a chat flow that holds two prompt rows: before the change the prompt row's `::before` resolves to `counter(prompt, decimal-leading-zero)` and the earlier prompt's footer computes `opacity: 0` while the newest computes `opacity: 1`; after the change the same row's `::before` computes `content: none` and both prompt footers compute `opacity: 1` with no pointer over either row.