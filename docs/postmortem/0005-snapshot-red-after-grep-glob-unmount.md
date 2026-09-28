# Post-mortem 0005: `test:snapshot` red after unmounting glob/grep without re-recording

English | [中文](0005-snapshot-red-after-grep-glob-unmount.zh.md)

Status: open

## Executive summary

The `feat/structure-your-search` merge unmounted `tool-fs-search` (glob, grep) from the `base` bundle, which the `sdk`, `headless`, and `acp` profiles all include. That is a model-visible change, so the keyless recorded-session snapshots for those profiles no longer match the replayed composition: `pnpm run test:snapshot` fails 29 of 133 replays. The fixtures were hand-edited rather than re-recorded, and re-recording needs `DEEPSEEK_API_KEY`, which the merge environment did not have. The merge was pushed to `master` with the gate red, pending a re-record.

## Summary

`test:snapshot` replays recorded sessions through the shipped profiles in a keyless mode and compares the replayed transcript against committed fixtures (`session.v3.jsonl`, `writer.expected.jsonl`, and the `system-prompt` / `tool-schemas` expected outputs). The unmount removed `tool-fs-search` from `packages/bundle/base/cordis.patch.yml` and from the standard, cordis, and ptc agent presets, so every profile built on `base` lost two tools.

The feature branch hand-edited the `.expected.md` / `.expected.json` tool-schema and system-prompt files to drop glob and grep, but did not re-record the sessions those files derive from. The replay therefore reconstructs a composition the recorded fixtures still describe, and diverges — most visibly `session-query-spill`, whose replay reproduced a shell `[exit code: 1]` where `SPILL_CANONICAL_OK` was expected.

## Impact

- 29 of 133 snapshot tests fail across `snapshots/sdk`, `snapshots/session`, and `snapshots/acp`.
- `test:snapshot` is the recorded-session acceptance gate, so `master` is red until the fixtures are re-recorded with `DEEPSEEK_API_KEY` (`pnpm run test:snapshot:record`).
- The unit, typecheck, lint, dependency, and catalog gates remain green, so the red is isolated to the replay fixtures.

## Timeline

- The feature was developed uncommitted in the `dsh-structure-search` worktree: source edits to `core/system-prompt`, the base and preset patches, and hand-edits to the snapshot fixtures.
- `09e006e847` committed that working tree to `feat/structure-your-search`.
- `b055fc6fd9` merged it into `master`; 55 snapshot files auto-merged and one conflict was resolved in favour of the feature's guidance text.
- `pnpm run test:snapshot` then failed 29 replays, and no `DEEPSEEK_API_KEY` was present to re-record.

## Root cause

The safety net that should have caught this is the recorded-session snapshot gate itself, and it did catch the failure; the miss was landing a model-visible tool removal without re-recording. A schema or system-prompt fixture is not the same as a replayed transcript: editing the `.expected` text to remove glob and grep does not change the recorded `session.v3.jsonl` that `test:snapshot` replays, nor does it re-run the agent it replays. The only path to a green gate was `test:snapshot:record`, which requires the API key absent from the merge environment.

## Guardrails added

- Re-record recorded-session snapshots (`pnpm run test:snapshot:record`) in the same change as any model-visible tool or profile change; do not hand-edit `session.v3.jsonl` or `writer.expected.jsonl` as a substitute.
- `test:snapshot` is run locally before merging a branch that changes `packages/bundle/*/cordis.patch.yml` or a shipped profile's tool surface.
- This document is the durable explanation for the deliberately-red gate so future readers do not re-derive the cause.

## Lessons

- Editing a recorded fixture and re-recording it are different operations; only re-recording regenerates the replayed transcript.
- A keyless replay gate is a semantic check on the shipped composition, not a formatting check on fixture files.
- Merging an uncommitted worktree wholesale inherits that work's unfinished verification state; run the acceptance gate the change targets before publishing.
