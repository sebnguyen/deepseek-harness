# Agent Note: Keyless-only snapshot maintenance

Status: implemented

## Problem

Recorded-session snapshots are the repo's keyless proof that shipped `dsh` profiles boot, compose the same model-visible request, and persist the same behavior end to end. Their write path was asymmetric with their read path: replay runs keyless everywhere, but regenerating a session fixture after any model-visible change ran `test:snapshot:record` against the live API, which needs `DEEPSEEK_API_KEY`. Keyless environments therefore faced a red lane whose only repair was a secret they do not have — [postmortem 0005](../../../../docs/postmortem/0005-snapshot-red-after-grep-glob-unmount.md) records the resulting hand-edited fixtures and red master — and four scenarios (`fs-edit`, `session-query-spill`, `subagent-tool-filter`, `image-compaction`) replayed tool surfaces or loop behavior removed by the glob/grep unmount and the write/edit unification, so the full lane never went green without a re-record. The write path also tried to solve an obsolete problem: committing recorded output no longer proves live-model fidelity for a tier whose replay input is exactly the committed fixture.

## Decision

The snapshot lane is keyless-only. `test:snapshot:record`, the `DSH_SNAPSHOT=record` mode, the repo-root `.env` load it required, `Scenario.recorded`, the manifest `recording` field, and the record write-back branches in `dsh-session-snapshot`, the headless/SDK/ACP/Web harnesses, and the web e2e scaffold are deleted; `replay` remains the gate and `refresh` remains the keyless golden rewrite. A new committed session fixture is hand-authored or carried over from an existing captured run, then `test:snapshot:refresh` rewrites its derived expected outputs; retained `sessionFormat` generations stay immutable. The expected-output specs that capture dispatched provider request bodies keep a caller-supplied real adapter through `RunOptions.mode: 'live'` with a loopback fixture server — keyless by construction, distinct from snapshot record because it never wrote fixtures.

Uncapped replay concurrency: `vitest.snapshot.config.ts` drops the five-worker cap and defaults `DSH_SNAPSHOT_MAX_CONCURRENCY` to `availableParallelism()`; replay suites stay read-only, so a host with more cores simply replays wider, and `DSH_SNAPSHOT_MAX_CONCURRENCY=1` restores serial replay.

Corpus trims replace obsolete coverage instead of carrying red scenarios: `fs-edit` replayed the removed `edit` tool (the current write tool and `fs-write` own the mutation coverage), `session-query-spill` replayed the pre-unmount search surface (spilled-result semantics stay covered by `bash-spill`, `session-reference-spill`, and `packages/session-query/tool-session-query` tests), `subagent-tool-filter` is covered by the subagent package specs' `toolFilter` assertions and the SDK subagent scenarios, and `image-compaction`'s compaction semantics stay covered by `compaction-recovery` and `inline-image-prompt`. Their directories, scenario-table entries, and the scenario-only verifier subroutine left `snapshots/` and the adapters.

## Verification

`pnpm run typecheck`, `pnpm run test:snapshot`, the `dsh-session-snapshot` and `llm-replay` package specs, and `pnpm run test:docs` run green keyless. `docs/testing.md`, `snapshots/AGENTS.md`, `root AGENTS.md`, and the session-snapshot README state the refresh-only maintenance flow; [the ACP snapshot note](2026-06-19-acp-snapshot-tests.md) and the web-lane notes carry the mechanic sentences in present tense.
