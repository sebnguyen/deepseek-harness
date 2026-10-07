# Agent Note: Grouped tool folds with replies rendered between

Status: implemented
Archived: 2026-10-07


## Problem

The compact transcript folded a Turn's whole process — every Context injection, Think, Tool row *and* every intermediate Assistant reply — behind one head disclosure labelled `N Tool Calls · M Messages`, leaving only the final answer visible. Readers of long turns lost the narrative: the model's interim messages are part of the answer trail, and counting them as hidden process material made the disclosure read like noise (`25 Tool Calls · 8 Messages` above one lone message).

## Decision

**Replies split the fold.** Under compact mode a settled Turn's process rows are partitioned into groups at every visible Assistant reply (`hasAssistantReplyContent`): each run of foldable rows collapses behind one disclosure rendered where the run begins — the head run at the `turn-process` row, every later run at the reply row that ends it — and the reply texts themselves stay rendered between the collapses (`[N tool calls] message [M tool calls] answer`, the Cursor layout). A run owns the Think of the reply that concludes it — the reasoning that produced that reply — and the answer's own Think: reasoning blocks riding visible reply rows hide behind that run's wrapper (`data-turn-process-inline`), so the column reads `[run] text`, never `[run] Think text`, live and settled alike (while the Turn streams, the open run owns the settling reply's Think even before rows exist). A settled reply that opened the Turn owns no preceding run; its Think rides the run that follows. The disclosure labels count `N tool calls · M thoughts · K subagents` over those rows, thoughts included. Reasoning-only Assistant steps remain fold members; a Turn whose only evidence is the answer's reasoning gets an anchor group at the answer row — its disclosure renders above the reply and its reasoning hides with the row's expansion.

**Running Turns use the same split.** A live Turn's finished runs collapse exactly like a settled Turn's, and the still-streaming run rides its own tail disclosure (a `Working`-labelled control whose group boundary stays null), so intermediate replies stay visible while the turn streams and settlement only closes the tail run into its final group.

**Groups own their expansion state.** The Chat store keys manual expansions per `(turn, answer step, group start seq)`, so widening one run never opens its neighbours; search-hidden members (`hidden="until-found"`) reveal through their own group. Each disclosure renders directly above its own rows, so every accordion opens downward: the run that opens the Turn rides the turn-process control row, every later run rides the reply that ended the previous one (both row kinds never fold), and a live tail rides the same reply — or the control row when the streaming run opens the Turn. A reasoning-only answer keeps its single-run collapse — including the answer's own reasoning — beside the reply; every other Think row is a group member, never a standalone fold.

## Verification

`packages/client/ui-chat/tests/chat-view.client.spec.tsx` pins the grouped layout end to end: replies visible between collapses, per-group expand/reveal, the head run riding the process row, tool-only labels, and the reasoning-only answer control; `chat-store.client.spec.ts` pins the per-group entry lifecycle; `pnpm run test:gui` scope (whole `ui-chat` package) and the repository typecheck stay green.

## Alternatives considered

**Keep counting messages in one disclosure.** Rejected on product direction: hidden replies were the complaint, not the collapse itself.

**Cursor-style per-tool chips instead of summary disclosures.** Rejected for now; it discards the shipped counts contract and the search-hidden member model without adding information density the current readers asked for.

## Consequences

- A settled Turn renders one disclosure per non-empty evidence run; turns without interleaved replies behave exactly as the pre-group fold (single head control).
- Fold controls sit at the 8px summary-to-answer rhythm, carry no divider line, and render at the tertiary label shade of the rows they fold. Member rows, disclosure bodies, and inline reasoning slide in both directions: `useFoldedHidden` (seat) and the `DisclosureRow` BodyShell keep the folded subtree mounted through a 170ms fold-out before handing it to `hidden="until-found"` and release the fold-out style one frame after revealing, so expansion and collapse both animate wherever transitions run at all (the `display: allow-discrete` exit path proved browser-fragile); test DOMs without `matchMedia` hide instantly, and every animation is off under reduced motion.
- The `TurnProcessSpec.messageCount` field remains as a durable record but no surface renders it; the locale dictionaries keep the retired keys for dictionary parity.
- `ChatNodeSeat` renders group disclosures itself; the `turn-process` keyed view declines its row, and the flow item's empty-state rule removes the declined seat from the column rhythm.
