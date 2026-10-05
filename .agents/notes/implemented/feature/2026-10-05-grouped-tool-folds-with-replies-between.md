# Agent Note: Grouped tool folds with replies rendered between

Status: implemented

## Problem

The compact transcript folded a Turn's whole process — every Context injection, Think, Tool row *and* every intermediate Assistant reply — behind one head disclosure labelled `N Tool Calls · M Messages`, leaving only the final answer visible. Readers of long turns lost the narrative: the model's interim messages are part of the answer trail, and counting them as hidden process material made the disclosure read like noise (`25 Tool Calls · 8 Messages` above one lone message).

## Decision

**Replies split the fold.** Under compact mode a settled Turn's process rows are partitioned into groups at every visible Assistant reply (`hasAssistantReplyContent`): each run of foldable rows collapses behind one disclosure rendered where the run begins — the head run at the `turn-process` row, every later run at the top of the reply row that ends it — and the replies themselves stay rendered between the collapses (`[N Tool Calls] message [M Tool Calls] answer`, the Cursor layout). The disclosure counts only Tool calls and subagent delegations; the `Messages` count and its locale rendering are retired from the control. Reasoning-only Assistant steps remain fold members; an answer whose reasoning is its only process evidence keeps its reasoning behind the `Thought for a while` control riding the answer row.

**Running Turns use the same split.** A live Turn's finished runs collapse exactly like a settled Turn's, and the still-streaming run rides its own tail disclosure (a `Working`-labelled control whose group boundary stays null), so intermediate replies stay visible while the turn streams and settlement only closes the tail run into its final group.

**Groups own their expansion state.** The Chat store keys manual expansions per `(turn, answer step, group start seq)`, so widening one run never opens its neighbours; search-hidden members (`hidden="until-found"`) reveal through their own group. Each disclosure renders directly above its own rows, so every accordion opens downward: the run that opens the Turn rides the turn-process control row, every later run rides the reply that ended the previous one (both row kinds never fold), and a live tail rides the same reply — or the control row when the streaming run opens the Turn. A reasoning-only answer keeps its single-run collapse — including the answer's own reasoning — beside the reply; every other Think row is a group member, never a standalone fold.

## Verification

`packages/client/ui-chat/tests/chat-view.client.spec.tsx` pins the grouped layout end to end: replies visible between collapses, per-group expand/reveal, the head run riding the process row, tool-only labels, and the reasoning-only answer control; `chat-store.client.spec.ts` pins the per-group entry lifecycle; `pnpm run test:gui` scope (whole `ui-chat` package) and the repository typecheck stay green.

## Alternatives considered

**Keep counting messages in one disclosure.** Rejected on product direction: hidden replies were the complaint, not the collapse itself.

**Cursor-style per-tool chips instead of summary disclosures.** Rejected for now; it discards the shipped counts contract and the search-hidden member model without adding information density the current readers asked for.

## Consequences

- A settled Turn renders one disclosure per non-empty evidence run; turns without interleaved replies behave exactly as the pre-group fold (single head control).
- The `TurnProcessSpec.messageCount` field remains as a durable record but no surface renders it; the locale dictionaries keep the retired keys for dictionary parity.
- `ChatNodeSeat` renders group disclosures itself; the `turn-process` keyed view declines its row, and the flow item's empty-state rule removes the declined seat from the column rhythm.
