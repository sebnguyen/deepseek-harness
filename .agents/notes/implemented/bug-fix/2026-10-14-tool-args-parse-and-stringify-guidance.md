# Agent Note: Tool-argument parse failures and stringified containers report themselves

Status: implemented

## Problem

Large tool-call payloads — big `multi_write` batches and `commands[]` volumes are the recurring case — intermittently arrive from the model with their batch fields double-encoded: the outer argument object is valid JSON, but `files` or `commands` holds a JSON *string* containing an attempted copy of the intended array, its inner escapes often broken (`\.` sequences, missing delimiters) and one outer key occasionally swallowed into the string body. Session-log evidence (the deployment session that shipped this fix, 2026-10-14): 5 such failures in one conversation against 84 healthy `multi_bash` siblings — same model, same tool, same payload sizes — ruling out payload truncation and transport mutation and pinning emission-side stringification drift, where the bulk of the damage was misdiagnosis, not the defect itself. The argument validator mapped both that shape and unparseable raw text (preserved as text by `parseArguments`'s preserve-as-text contract in `packages/core/agent-loop/src/tool-calls.ts:104-111`) onto schema violations the model had not committed — `"files" must be an array`/`"arguments" must be an object` — so transcripts retried the same oversized call verbatim: observed earlier that day when a session failed `Write` three times on a large note build before discovering small sequential inserts by accident, and reproduced live four more times in the fix's own session (`"files"` and `"commands"` variants).

## Decision

`validateArgs` (`packages/core/tools/src/schema.ts`) now reports the corruption directly instead of its schema side-effects. A raw-string argument value — only reachable when JSON parsing failed upstream — yields a single violation naming the parse failure with the received byte count and the truncation/mis-escape reading, plus the split-payload recovery instruction. A `"path" must be an array` or `"path" must be an object` violation whose live value at that path is a string gains a conditional clause (`received a string instead — if the payload was stringified …`) naming the emitted shape and the same recovery: emit the literal, split large payloads across several calls. Path resolution handles dotted properties and array indices (`files[0].edits`) and is best-effort: unresolved paths and non-string values keep the bare violation.

The change is error-text only: no wire format, schema, registry, or executor behavior moved, and `ToolArgsError` keeps its code and shape. Tests pin the guidance strings in `packages/core/tools/tests/schema.spec.ts` (`validateArgs recovery guidance`) and refresh the one pinned bare-mismatch assertion in `tools.spec.ts:2600`.

## Alternatives considered

**Fail the call at parse time.** Rejected: changing `parseArguments`'s preserve-as-text policy rewrites what every logged session contains for corrupt calls and shifts the error surface of every surface that replays it; the string branch detects the identical condition at validation time without touching the parse contract.

**Auto-repair stringified containers** (parse the string and continue). Rejected, and re-rejected the same day with recurrence evidence in hand: [the salvage note](../../rejected/bug-fix/2026-10-14-stringified-argument-salvage.md) records the implemented-and-reverted salvage pass and why silent normalization was declined — this note's anti-silent-repair objections carry, and what remains earns the hinted error below.

**Per-tool messages in `multi_write`'s own validator.** Rejected: the corruption is tool-agnostic — every batched tool (`commands`, `files`, `todos`, `questions`) hits it — so the guidance belongs in the shared validator next to the schema walk.

## Consequences

- Corrupt-cargo failures now name themselves (`arguments are not valid JSON …`, `"files" must be an array; received a string instead …`), which readers and models can act on directly instead of re-deriving the cause from a schema violation.
- Normal typoed arguments (a plain string where an array belongs) now also carry the conditional stringified-payload clause; the clause is explicitly conditional so it reads as trivia, not accusation, and the leading mismatch sentence is unchanged.
- Prevention remains impossible at this layer — the corruption happens in model emission — so these are recovery affordances; the [flattened batch shapes in the thin-catalog note](../../proposed/simplification/2026-10-14-thin-shipped-tool-catalog.md) remove the shape joints where the defect struck, leaving this hinted error as the strict acceptance floor.
