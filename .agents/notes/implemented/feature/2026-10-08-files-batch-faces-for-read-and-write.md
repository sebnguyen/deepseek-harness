# Agent Note: `files` batch faces for `read` and `write`

Status: implemented

## Problem

The frames `bash` surface made one tool call carry one whole thought — several commands, one `tool/call`, failures settling in labeled frames ([multi-command shell calls](2026-10-07-multi-command-shell-calls.md)). `read` and `write` kept singular faces: every independent read of one thought, or every file of one multi-file fixture, cost N round trips, and a single refused element failed the whole call even when no element depended on another. The corpus problem was immediate: every recorded session replays committed singular `{ file_path, ... }` calls, and a keyless snapshot replay re-executes recorded args through the current tool implementations, so flipping the schema outright would fail schema validation on every recorded fs call.

## Decision

Both tools ship a single validated batch face — `read: { files: [{ file_path, offset?, limit? }] }`, `write: { files: [{ file_path, content?, edits?, overwrite?, dry_run? }] }` plus the call-level escalation pair under a confining backend — and the singular parameter face survives only as an explicit plugin config: `legacyFaces: true` on `tool-fs`.

- **Serial dispatch, per-element settlement.** Elements run in written order; each settles into its own frame `[i/N] <path>` with a success envelope, `[error: …]`, or `[not run: call aborted]` when the call signal aborted before the element started. A failed element never fails the call and never blocks later elements; `write` commits each element atomically, so element three can patch the file element one created. Read could later go parallel (its frame order is already label-driven); serial keeps one abort/waterfall policy with the bash precedent.
- **Singular face is config, not schema compat.** `applyReadTool`/`applyWriteTool` take a `legacy` flag; `applyLegacyReadTool`/`applyLegacyWriteTool` reproduce the pre-batch registrations byte-for-byte (schema, advice text, presenters). No element-tolerant branch inside the batch schema, no runtime silent-upgrade of singular args: the face is chosen once at load, and misconfiguration fails loud.
- **Test-lane pin until re-recording.** Every shipped composition that can boot a replayed session (`packages/bundle/base/cordis.patch.yml` and the `standard`/`cordis`/`ptc` preset rows) carries `legacyFaces: !!js process.env.VITEST === 'true'`. Vitest sets `VITEST=true` for its own process and snapshot-app subprocesses inherit it, so `pnpm run test`, `test:expected`, `test:snapshot` (replay/refresh/live), `test:web`, and the acp/sdk harnesses keep the singular face their recorded corpora and pinned sidecars were made against; a live `dsh` launch, desktop, or production web boot has no `VITEST` and gets the batch face. The keyless corpus stays green without a legacy arm in the model-facing schema, at the price of re-recording the fs scenarios once a recording key returns.
- **Frames meta is the replay-safe card input.** `read` persists one window per successful frame under `meta.frames` and `write` one `diffs` list per committed frame; `bounds` (`maxFilesPerCall`, default 8) are validated config. The rendered text keeps the `[i/N]` grammar so the Web client can split it live exactly as it splits frames bash output.
- **Web cards derive the batch face.** `read-card-model` accepts `files` args and renders the first successful frame's window (the row is a one-card summary; the sectioned raw body stays generic-aware), `readCallLine` follows the displayed element once settled, and `diff-card-model` shows every element's intent while running and merges frame `diffs` when settled; malformed or mismatched payloads keep the generic card.

## Alternatives considered

**A schema that accepts both singular and batch args.** One parameter object with optional `file_path` XOR `files` works for live calls but makes replay ambiguous — a recorded singular call would validate against the batch schema and execute as a one-element batch, silently changing the model-facing result text the session log promised. Rejected: the face must be chosen before args arrive.

**Silently upgrading singular args into a one-element batch at execute.** Same failure as above plus a third result format (singular envelope) that no schema of the current face ever produced; a recorded session must replay byte-identically.

**Accepting the corpus break now and refreshing sidecars.** Re-recording needs a provider key this session did not have; breaking the keyless snapshot lane would break every unrelated PR until someone re-records. The VITEST pin preserves the lane; re-recording stays one keyed run away.

**Live-mode env gates (`DSH_SNAPSHOT`) instead of `VITEST`.** Some test-lane boots (plain `pnpm run test` unit compositions, web scaffold before its own env scramble) run with `DSH_SNAPSHOT` unset and would have received the batch face while their fixtures assert singular behavior. `VITEST` is set by the runner for every lane that matters and inherited by subprocesses, which is exactly the population that replays committed fixtures.

## Consequences

- Model-facing `read`/`write` schemas, guidance sections, and result envelopes changed once; `docs/tool-catalog.md`, `docs/config-catalog.md`, and the `dsh-tool-fs` README Model Experience now describe the batch face, and the named `legacyFaces` pin documents when the singular face appears.
- The recorded-corpus debt is visible and bounded: fs scenarios couple to the singular face through the VITEST pin, and one keyed `test:snapshot:refresh` plus e2e re-record deletes the pin line-by-line (delete the `config:` block from four ymls, flip `legacyFaces` mounts in unit specs and `tests/harness.ts`).
- Batch validation errors (`files must contain at least one element`, bounds) are call-level failures; value-level per-element errors settle in-frame, matching the bash precedent.
- The `fs-tools` with-key e2e no longer names a never-registered `edit` tool; it drives the shipped write-with-edits patch path.
- Web cards for batched `read` show one card for the first successful frame by design; a multi-card batch row is deferred, not rejected, and `diff-card-model` already stacks every committed frame's hunks.
