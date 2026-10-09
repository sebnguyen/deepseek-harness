# Agent Note: Line-anchored editor notes as recallable prompt snapshots

Status: implemented

## Problem

A user reading a session's file in the Web editor can see exactly which line is wrong but has no way to pin that observation to the line: the only line-level affordances are navigational (`openFile(path, { line })` from read and search cards, the text preview's `?line=` anchor), per-message feedback carries no file anchor, and the `@` snapshot mention addresses a whole-file stop (`path#turn#callId`), so asking the agent to fix "the 401 on line 7" means retyping the path, the line, and the code line into the composer by hand — and once the file changes, the line the user meant is gone from both the buffer and the prompt. The checkpoint package already persists per-session state on disk for exactly this reason, so the missing piece is a slot in that store that names a line, plus an editor gutter that reads and writes it.

At the same time, the client half of the shipped checkpoint stream was itself unfinished: the turn-tail chip row, the typed-`@` submit expansion, the sent-message snapshot chip, the Changes tick card and source markers, and the Files view retirement all sat against the stop fold. Several of them are per-kind copies of one generic need — show this session's captures in this transcript — so finishing them as bespoke stop readers would build the duplication the slot spine exists to prevent; this note takes them over as refactors onto the spine.

## Decision

The checkpoint is a general register: one append-only, undeletable slot log per session, keyed a second time by file, each slot optionally scoped to a turn or a tool-call id, shipped in `packages/fs/checkpoint` (fork master `184dbc31d8`). The service API is deliberately small — list the register as a map of file to slot array, add a slot, append a tombstone — and producers inject their own payload through the declaration-merged `CheckpointSlotDetailMap`. Shipped write captures ride it as the git-work-tree snapshot producer with `slotId = callId`; the line-note feature rides it as the comment producer; the `@` pipeline, the editor gutter, and the Changes cycler all resolve addresses by filtering the one register.

In product terms, three things shipped:

- **Line notes.** `@deepseek-ai/dsh-client-ui-line-note` at `packages/client/ui-line-note/` contributes a gutter widget left of the line number through the `editor.cm.extension` list slot: hover shows `+`, a line with a note shows `✎`, the popover mints a `note-<12 hex>` slot through `slotPut` with `retained` the line's current text, and the register read rides the session-standard `lineNotes` hook. The [interactive mock](./2026-10-08-line-anchored-editor-notes-as-prompt-snapshots.mock.html) shows the loop on the shipped dark chrome, and the [demo recording](./2026-10-08-line-anchored-editor-notes-as-prompt-snapshots.mock.gif) runs hover → popover → quote → inline chip → send.
- **The finished "what did the agent touch" surface.** Each agent turn closes with a chip row of the files it changed with `+n −n` badges and click-through to the frozen diff (`conversation.chat.turnChips` list slot); typed `@` snapshot mentions expand at submit; sent messages show snapshot chips and note chips in `projectUserText`; the editor's source mode grows change-marker gutter dots from the same `editor.cm.extension` seat; the retired Files tab's `useFileHistory` fold is the thin projection of `remote.checkpoint.slots` until `stops` retires.
- **One durable register underneath.** Notes and work-tree captures persist per session on the host, survive restarts, and appear identically in a second client of the session; further producers join by declaring a detail-map member, not by forking storage or UI.

The session log stays out of the register entirely: slots are store rows, not events. `Session.append` builds its envelope itself and offers no writer path for the envelope-level `ignorable` marker, so the earlier draft's key-ping index event would have required a `dsh-session` surface change before the feature needed one; the register needs no such event, and live refresh rides the session binding's revision bump the `ui-file-history` fold already uses.

## The slot register

`dsh-checkpoint/types.ts` carries the slot core beside `CheckpointRow`; the store persists one row per mutation under `<dshHome>/checkpoints/v1/<sessionId>/slots.jsonl`, append-only, surviving crashes like the blob store does. The core carries the generic scopes and what a generic UI renders; per-producer payloads ride the declaration-merged map so both planes compile against it without the service knowing any producer:

```ts
/** Identity of one slot in the session's register; the producer mints it. */
export type CheckpointSlotId = string & { readonly __checkpointSlotId: never }

/** Core record every slot carries; what the generic client renders and filters. */
export interface CheckpointSlot {
  readonly slotId: CheckpointSlotId
  /** Producer kind key; the merged detail map is keyed by it. */
  readonly kind: string
  /** Session-relative path, slash-separated, relativized like CheckpointRow.path. */
  readonly path: string
  /** Producer-supplied one-liner: tooltip and transcript chip text. */
  readonly label: string
  /** Optional turn scope. */
  readonly turn?: number
  /** Optional tool-call scope; the worktree producer mints its slotId from it. */
  readonly callId?: string
  /** Line anchor when the producer has one; the note kind pins it. */
  readonly line?: number
  /** Shadow snapshots in the blob store; digests only, both optional. */
  readonly before?: SnapshotDigest
  readonly after?: SnapshotDigest
  /** Host-assigned creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Per-producer payload; an empty object for kinds that need none. */
  readonly detail: Readonly<Record<string, unknown>>
}

/** Per-producer payload; declaration-merged like SessionEventMap. */
export interface CheckpointSlotDetailMap {
  /** A line the user pinned; the comment producer. */
  readonly note: { readonly text: string }
  /** A committed write the capture gate recorded; slotId reuses the call id. */
  readonly worktree: { readonly toolName: string }
}
```

The register is undeletable: `putSlot` and `releaseSlot` are its only mutations and both append; no host or remote method removes or rewrites a row. Releasing a note appends a tombstone row that folds to absent in every view while the put row itself stays in the log, so a mention that raced into a `user/message` still resolves afterward. Provenance is producer-honest: the worktree producer mints `slotId` from the tool-call id and stamps `callId` with the same value, so the shipped `@path#turn#call-id` grammar resolves by filtering the register, and the note producer mints `note-<12 hex>` ids the `#L<line>#<note-id>` grammar names.

`retained` strings are hashed into the existing per-session blob store at put time — the worktree producer's before/after blobs keep living exactly where they lived, ref-wise unchanged — so only digests ride the row and the blob store's no-prune posture covers both kinds. Config carries `maxLabelBytes` and `maxRetainedBytes` in `packages/bundle/base/cordis.patch.yml` (`2048` and `8192`) — no `DEFAULT_*` constants, per the no-hardcoded-tunables rule. `putSlot` rejects its caller on bound violations and duplicate ids, the opposite of `captureWrite`'s observation posture: a producer's put is a request, not an observation.

## The Web plane read

The DOM reads the register through the react-free store idiom the client owns: `@deepseek-ai/dsh-client-store`'s `ObservableSnapshot`, one memoized per session binding, the same pattern `dsh-client-ui-file-history` builds over `binding.eventSource` (WeakMap of sources, fold re-keyed on revision). The slot version re-fetches `remote.checkpoint.slots` when the binding's revision bumps, so gutter markers, the Changes cycler, the turn-tail chip row, and the `@` picker read one store — one source of truth, four projections, no per-view fetches. Register state is store-only, so the fold is correct on a cold open and in a second client; the revision bump only bounds its staleness.

## The line-note and `@` consumer seams

The `@` pipeline's data-source seam absorbs the register: `ui-reference` awaits `slots(sessionId)` beside the stop fold, filters `kind: 'note'`, ranks with the same `rankByName`, and emits candidates with mention `@<path>#L<line>#<note-id>` (`parseNoteRef` in `ui-primitives/snapshot-ref.ts`; `parseSnapshotRef` is untouched, path still everything before the last two `#`). `ReferenceInsert.appearance` carries `'note'`, and `ReferenceIcon`'s closed switch carries the pencil case. The codec inlines `${ref}\n${text}` plus the fenced frozen line read through `checkpoint.blob(after)` — the codec resolves the digest to raw text at serialize time and only there, answering an absent blob with an empty fence rather than an abort.

## Takeover of the in-flight checkpoint stream

The sibling note `2026-10-07-in-editor-changes-display-and-files-view-retirement.md` owned the shipped changes-display stream; its remaining work shipped onto the register:

- **T1 — worktree producer.** `captureWrite` additionally calls `putSlot` with `kind: 'worktree'`, `slotId = callId`, the same digests, and `detail.toolName`; the write gate, the blob writes, and `dsh-tool-fs` are untouched. `checkpoint/scan` still dual-emits until `stops` retires.
- **T2 — the chat chip row.** `TurnChipRow` renders once at each agent turn's tail from the register restricted to the turn; per-file `+n −n` is the client-side `frameDiff` over two `blob` reads; chips use the shipped inline-reference treatment with click `openFile(path, { display: 'changes', stop })` or `{ line }` for notes; copy is locale-owned in the ui-chat dictionary.
- **T3 — typed `@` tokens expand at submit.** TextRefNode tokens serialize through the same codec at submit in the `ui-conversation` input facade against the input-trigger lexicon; the composer scan (`TEXT_REF_RE`) admits both `#` tails and feeds decoration, projection, and the submit gate from one pattern.
- **T4 — sent-message chips.** `projectUserText` detects the `#turn#callId` and `#L<line>#<note-id>` tails on plain `@` tokens and renders the clock and pencil kinds with their click destinations (`{ display: 'changes', stop }` and `{ line }`).
- **T5 — Changes tick hover card.** The scrubber tick's hover/focus card shows `+n −n` derived via `frameDiff` over `blob` reads, and the line-number track comes off the register fold.
- **T6 — source-mode markers.** Change markers in the code gutter arrive as an `editor.cm.extension` contribution from `ui-editor` itself, sibling to the note gutter from `ui-line-note` — one composed gutter stack, two providers.
- **T7 — Files view retirement.** `FileHistoryView.tsx`, its css, the `conversation.view` registration, and the `view.files` locale key are gone; `fold.ts` is the thin projection of `remote.checkpoint.slots`; the client slot catalog was regenerated.

## Verification

Per-file 100% coverage on every touched `src` file under the partitioned coverage gate; `verify-client-ui-i18n` (656 files) and `verify-cordis-config` (140 configs) green at the landing commit, with `verify-export-jsdoc` carrying only its two pre-existing master-side misses; targeted suites cover the gutter popover, the chip row click-through, the typed-token submit gate, codec round trips, and the fold projections; the client typecheck builds both faces clean.

## Alternatives considered

**Finishing the in-flight stream against the stop fold, no register.** Every remaining task would have been one more bespoke reader of `stops`: the chip row, the tick card, the markers, the `@` source, and the note feature as a sixth. The stream's own step list already folded the same rows in four client sites; adding the note there makes five folds over one store, which is the duplication the register exists to prevent.

**A key-ping session event beside the register, an earlier draft.** The envelope's `ignorable` marker has read and restore support but `Session.append` exposes no writer path for it, so the ping would have required a `dsh-session` envelope change before the feature needed one, and `checkpoint/scan` already pings the shipped chip fold for the interim. The register reads without any event; the ping question reopens only if refetch-on-revision proves too coarse.

**A consumer package with verbatim log payloads (`dsh-line-note`, an earlier draft).** Log-retained payloads and a bespoke service are the right mechanics for feedback, but they promote one producer's UI state into the event vocabulary and make every reader of the log learn the feature. The store is the body, and the general surface outlives the first producer.

**A required-on-read `checkpoint/slot` event with an in-service producer registry, an earlier draft.** It rewrote the shipped `checkpoint/scan` fold, generalized events for hypothetical producers, and put a runtime registry where Cordis composes at the loader. The store-keyed register keeps writes as data calls and the extension seam as a declaration merge.

**Delete semantics on the register.** A remove-row API would break replay-correctness for mentions that already serialized, and would tempt view cleanup into history rewriting. Tombstones keep the log append-only and the views clean at once.

**Adding a kind field to `CheckpointRow`.** Rows' mandatory write-call identity and before/after write-gate contract make that a provenance falsification; slots are a sibling row family in the same store, not a mutation of rows.

## Consequences

- Store-as-body means a session log copied without its `<dshHome>` checkpoint directory loses note bodies; serialized messages that already raced into `user/message` survive, the authoring surface does not. Recorded in the checkpoint README's Known Limitations.
- The register's write posture splits: `captureWrite` swallows store failures, while `putSlot` rejects, so a plugin observes its own put failure instead of losing a note silently.
- Undeletable by design, the register grows per session; the pruning posture is named in Deferred rather than shipped half-formed.
- Every label rides locale dictionaries across `ui-line-note`, `ui-editor`, `ui-chat`, and `ui-reference`.

## Deferred

- `checkpoint/scan` dual-emits until `stops` retires with its last caller relocated; the retirement PR removes the fold and its expecteds in one change. The `apps/web` replay expectations for the gutter, popover, chip row, and serialized chip remain unbuilt; the component suites own the behavior meanwhile.
- Whether the gutter control doubles as a right-click line menu stays deferred: `EditorBody` mounts no `onContextMenu`, and the mock keeps one left-click.
- Fork inheritance of slots past blob inheritance is whatever the store defines at `stops` retirement; a fork that copies slots but not blobs would dangle digests.
- Resolved-note folding in the `@` picker (listing as open only notes whose frozen line still differs from the current line) needs a cheap current-line read per candidate; the picker's latency budget decides it.
- Untended notes outlive their fix; the open/resolved split is a follow-on note, not a retrofit here.
