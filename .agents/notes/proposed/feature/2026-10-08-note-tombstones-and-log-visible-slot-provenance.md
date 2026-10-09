# Agent Note: Tombstoning line notes and log-visible slot provenance

Status: proposed

## Problem

The register is write-only from the Web. The gutter popover puts `kind: 'note'` slots and the `slotRelease` remote exists on the host, but no client surface calls it: the ✎ marker on a noted line reopens the composer and invites a second note rather than managing the ones already there, and the turn-tail chip row renders note chips with no withdrawal gesture. A misplaced or obsolete note stays drawn, stays listed in the `@` menu, and stays serializable into prompts until host code releases it. The append-only tombstone contract that makes withdrawal safe — rows and blobs stay, so already-submitted mentions keep resolving — is in place with nobody on the client side using it.

The same register-only posture leaves slot provenance out of the session log. `slots.jsonl` is the per-session store and the fold reads no slot event, which is what makes restart and second-client reads work, but it also means a log read learns nothing about notes: forks inherit every parent turn yet cannot name the files the parent noted, exports and SDK reconstructions see tool calls without the note overlay, and `checkpoint/scan` — the one log record that names touched files — covers worktree captures only and is the dual-emit the stops retirement removes. Live reads need the register; provenance needs a log record the register never was.

## Proposal

Three parts ship together.

**A withdraw gesture on the noted line.** The ✎ marker's popover becomes a management view when the line holds notes: one row per live note slot on that line — label and the retained line text — each with a ✕ that calls `remote.checkpoint.slotRelease(sessionId, slotId)`; a line without notes keeps today's composer. The turn-tail chip row gives its note chips the same ✕. Release appends the tombstone row, the fold drops the slot, and the mark, chip, and menu row disappear through the same revision-refresh path a put rides. Withdrawal never deletes: rows and blobs stay, so a mention already submitted in a user message still serializes and still opens its retained line, per the register's append-only contract.

**A log-only `checkpoint/slot` event.** `putSlot` and `releaseSlot` each append one known session event carrying `{ slotId, kind, path, line?, turn?, released? }` — no retained text and no digests, so the mirror never carries byte-bound payloads. The event is declared in the checkpoint package's event map as not surface-eligible: `deriveEventMessage`'s default arm already returns null for every non-message type, and `validateSurfaceMetadata` therefore classifies it log-only with no `surfaceOp`. A new additive event type needs no `SESSION_FORMAT_VERSION` bump.

**A provenance collector over the slot events.** A host-side fold, `touchedFilesFromLog(events)`, reduces slot events to the session's touched-file list, note paths included and released slots counted as touched-then-withdrawn. The SDK, export, and any reconstruction that reads a log without the store consume it. The register remains authoritative for every live read — gutter, menu, chips, file-history fold — and no read fold ever consults the event mirror, so the mirror's worst failure is provenance staleness, not a wrong live surface.

The [interactive mock](./2026-10-08-note-tombstones-and-log-visible-slot-provenance.mock.html) shows the withdraw gesture, the append-only ledger, and the fork reading parent provenance from the log on the shipped dark chrome.

## Fork and restart semantics

The log forks; `slots.jsonl` does not, and a fork's register starts empty. The collector over the forked log therefore names the parent's touched and noted files while the fork's live surfaces start clean and accumulate only the fork's own slots. That asymmetry is the product behavior this note specifies: history rides the log, live state rides the register, and the two are never reconciled into one source. After a restart of the same session the register and the collector agree by construction, since both replay their own append-only record.

## Alternatives considered

**Why not delete the row or prune the blob instead of tombstoning?** Submitted chips and frozen Changes displays cite released slot ids and read their blobs; deletion breaks resolution of mentions that already reached the model. The append-only row is the register's invariant, not an implementation detail.

**Why not copy `slots.jsonl` at fork time?** A note pins a line number against the parent's file state; redeclaring parent notes as live in a fork whose files may diverge misdraws marks over unrelated lines and interleaves foreign slots with the fork's own captures. What a fork should inherit is the fact that the parent touched those files — provenance — and the log carries it once the events do.

**Why not fold slots from the log and delete the register?** That is the pre-register shape this spine replaced: every read scans the log, while restart without a log scan plus identical second-client reads were the register's reason to exist. The event added here feeds provenance readers only.

**Why not extend `checkpoint/scan` to notes?** Scan is capture-shaped — callId, before/after digests, tool name — and is dual-emitted pending the stops retirement; a note has no tool call and no digests. Extending the retiring event to a second kind formalizes the debt; a uniform slot event covers worktree and note rows with one payload.

## Acceptance criteria

- The ✕ on a noted-line popover row and on a turn-chip note releases the slot: the mark, chip, and `@` row disappear through the revision path on every attached client, and a second client observes the withdrawal without a reload.
- `serialize` of an `@path#L<line>#<id>` mention submitted before the release still returns the note text and retained line after it.
- `deriveMessages` over a log containing `checkpoint/slot` events is byte-identical to the same log without them, and `validateSurfaceMetadata` returns undefined for each such event; forked replays accept the event without surface change.
- `touchedFilesFromLog` names every file a live or released slot touched, note paths included, identical across restart, and inherited from the parent log on forks whose own registers are empty.
- Per-file 100% coverage on every touched `src` file under the partitioned coverage gate; `verify-client-ui-i18n`, `verify-export-jsdoc`, and the Agent Note format gate green; the withdraw copy rides the owning locale dictionaries.

## Risks

- Dual-write drift: a `putSlot` whose event append fails, or an event without its row, leaves provenance silently stale. Bounded by design — no live fold reads the mirror — and a register-versus-log audit is available later if provenance ever joins an executed gate.
- Log growth: two small events per slot lifecycle instead of zero; the payload omits retained text and digests and stays under the existing label byte bound.
- Withdrawal reads as erasure: the ✕ tombstones while the rows and blobs remain, so copy must say a note is withdrawn from live surfaces, not that history is deleted, and no surface may promise row deletion.
