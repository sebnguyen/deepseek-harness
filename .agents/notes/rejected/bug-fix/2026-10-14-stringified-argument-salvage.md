# Agent Note: Salvage stringified argument containers before validation

Status: rejected — silent normalization declined; corrupt arguments fail with a hinted error and the model retries

## Problem

The guidance fix earlier on 2026-10-14 ([argument parse and stringify guidance](../../implemented/bug-fix/2026-10-14-tool-args-parse-and-stringify-guidance.md)) made corrupt tool arguments *name themselves*, but the corruption kept recurring and paying a failed call each time. Session-log evidence pinned the recurring signature: the model sporadically double-encodes its batch arguments — `{"files": "[{...}]"}`, the container as a JSON string — with inner escapes often broken. The concern investigated here was that a salvageable majority could be restored in the validation pass with a strict parse plus one bounded escape repair.

## Proposal

Run a schema-walking salvage over parsed arguments before validation: for each `object`/`array` node holding a string value, strict-parse the string and, on failure, apply one lenient repair (stray-backslash escaping, `\d` → `\\d`); salvage containers validate and execute as their intended shape while unrecoverable corruption keeps the hinted error. The mechanism was implemented and tested in `packages/core/tools/src/schema.ts` (`recoverStringifiedContainers`, `recoverContainer`) with execute-level suites in `tools.spec.ts`, in this session — and reverted the same day when the product call landed on strict acceptance instead. The code is recoverable from git if a future deployment measures a defect rate worth revisiting.

## Why rejected

Salvage makes the defect invisible: the model never learns it was repaired, the harness quietly accrues a second accepted wire format at the layer where it asked the model to stay strict, and reading model intent through corruption is guesswork beyond the one clean class. Prevention was judged better placed in shape design: [the thin-catalog flatten](../../proposed/simplification/2026-10-14-thin-shipped-tool-catalog.md) removes the object↔array joint where every recorded defect struck, and the [guidance note](../../implemented/bug-fix/2026-10-14-tool-args-parse-and-stringify-guidance.md) supplies the honest hinted error for what remains.

## Alternatives considered

**Keep the salvage as the default acceptance path.** Rejected as stated above; an opt-in variant was equally declined — a hidden normalization knob a deployment might enable changes the surface the model can rely on.

**Salvage at `parseArguments`** (the agent loop's parser). Rejected there too: out of schema context the parser can't distinguish a stringified container from a legitimate string, and the fix belongs where the parameter schema lives.

**A lenient JSON repair library** (quote repair, trailing-garbage truncation). Rejected: unescaped-quote and swallowed-key corruption cannot be repaired without guessing content, and a guessed body is worse than a named failure.
