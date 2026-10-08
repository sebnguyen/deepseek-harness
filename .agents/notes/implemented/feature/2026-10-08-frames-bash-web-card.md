# Agent Note: Frames bash web card — one terminal block per batch element

Status: implemented

## Problem

The frames `bash` tool settles a `commands` batch as one sectioned text block, and its Host presenters are deliberately generic because one terminal exit pill cannot represent several elements ([commands-only bash surface](2026-10-07-commands-only-bash-surface.md)). The Web Client therefore showed a running batch as a non-expandable generic row and a settled one as a fenced console blob: per-element exits, sandbox attribution, and job ids were only readable as text, nothing folded, and nothing stated how long the call or its elements took. The [multi-command shell calls](2026-10-07-multi-command-shell-calls.md) note had anchored the web experience on the generic cards; a batched card was deferred, not rejected.

## Decision

The Web Client owns the batched presentation; the Host renderer the model sees stays byte-stable.

- `dsh-tool-bash-frames` stamps each foreground frame with `durationMs` (integer wall milliseconds measured around that element's `ctx.shell.run`) in the canonical value and projects an index→duration list through `output.presentationMeta`, so the session log replays per-element durations. Model-visible text, markers, and the `[i/N] $ command` grammar are unchanged.
- `@deepseek-ai/dsh-client-ui-tool` replaces the sample keyed `bash` toolview with `bash-row` whose pure derivation `bash-frames-model` splits the settled result text at the `[i/N] $ command` headers rebuilt from the call arguments — the same grammar `renderFrames` emits and `parseExitStatus` already reads locally — and maps each section to a card: foreground frames become one `TerminalBlock` each (output scrolls inside a bounded card through the shipped `--dsl-terminal-output-max-height` scrollbar instead of a line cap), job frames become a tray row carrying the new `IconDetachOutline12` glyph plus a localized `started background job <id>` line, not-run frames keep the warning dot and the skip reason. Non-batch shell calls, persistent shells, spill previews, errored batches, and any text the header grammar does not line up with fall back to the single-exit terminal card or the generic IN/OUT card as before; the sample row is deleted.
- Elapsed time is component-local while running (a 100ms tick in the row suffix and each pending card's banner accessory) and pure once settled: the suffix freezes to `result.time − call.time`, and each card's accessory reads its `durationMs` from persisted meta. The `TerminalBlock` primitive gains an optional `accessory` ReactNode between the status pill and the copy control for owner-localized banner facts; primitives stay locale-free, the row supplies the localized string.
- Conversation locales gain `bash.duration.seconds|minutes|hours` (one-decimal seconds under ten, integer seconds, then minutes and hours), `bash.backgrounded`, and `bash.notRun` in both dictionaries.
- The detach glyph is an arrow descending into an open tray. Its authoring review rejected an out-of-box arrow because at 12px it read as the male sign (♂); the tray form keeps the circle out of the composition.

## Alternatives considered

**Structured per-frame meta as the card's only input.** Meta is persisted and replay-safe, but live rendering would then depend on events the Chat snapshot does not carry; content-splitting the rendered text keeps the live and replayed paths on one derivation, and meta carries only what text cannot — the durations.

**Per-element session events or parented sub-calls.** Rejected for the Host plane by the multi-command note's synthetic-pairs decision; the Web card derives without inventing calls the model never emitted.

**Head/tail line cap with an expand toggle per frame.** V1 of the design mock used it; review replaced it with the bounded scrollbar — one noisy element must not hide the batch behind a toggle, and the shipped terminal output already scrolls.

**A second keyed toolview under a different wire name.** Both providers register the same tool name `bash`; the keyed dispatch is the wire-name contract, so the row discriminates the face from the call body exactly as `terminalCardModel` discriminates shell shapes today.

## Consequences

- Batches render per-element status, attribution, copy, and duration on live turns and on replay; older recordings without presentation meta lose only the duration accessories.
- The only clock in the card is the component-local running tick; settled copy is a pure function of node times and persisted meta, per the registrant purity rule.
- `bash` foreground frames gain `durationMs` in the tool schema and catalog; snapshot harnesses mount the singular tool, so recorded sidecars are unaffected.
- `ui-primitives` publishes one shared glyph for detachment; reuse it for any future "handed to a job" surface rather than inventing a second arrow.

## Testing

`packages/client/ui-tool/tests/bash-frames-row.client.spec.tsx` covers the derivation (pending list, status split, signal/job/not-run frames, meta durations, grammar-mismatch fallbacks), `durationText` bucketing in both locales, and the row (pending cards with live suffix, per-frame pills and accessories, detach rows, expand/collapse, error fallback, stopped state, single-exit fallback). The frames tool keeps its 100% gate with the new stamp and projector.
