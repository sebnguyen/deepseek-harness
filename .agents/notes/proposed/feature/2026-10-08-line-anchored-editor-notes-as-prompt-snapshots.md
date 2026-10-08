# Agent Note: Line-anchored editor notes as recallable prompt snapshots

Status: proposed

## Problem

A user reading a session's file in the Web editor can see exactly which line is wrong but has no way to pin that observation to the line: the only line-level affordances are navigational (`openFile(path, { line })` from read and search cards, the text preview's `?line=` anchor), per-message feedback carries no file anchor, and the `@` snapshot mention addresses a whole-file stop (`path#turn#callId`), so asking the agent to fix "the 401 on line 7" means retyping the path, the line, and the code line into the composer by hand — and once the file changes, the line the user meant is gone from both the buffer and the prompt. The checkpoint package already persists per-session state on disk for exactly this reason, so the missing piece is a slot in that store that names a line, plus an editor gutter that reads and writes it.

At the same time, the client half of the shipped checkpoint stream is itself unfinished: the turn-tail chip row, the typed-`@` submit expansion, the sent-message snapshot chip, the Changes tick card and source markers, and the Files view retirement all remain against the stop fold. Several of them are per-kind copies of one generic need — show this session's captures in this transcript — so finishing them as bespoke stop readers would build the duplication the slot spine exists to prevent. This note takes them over as refactors onto the spine.

## Proposal

The checkpoint becomes a general register: one append-only, undeletable slot log per session, keyed a second time by file, each slot optionally scoped to a turn or a tool-call id. The service API is deliberately small — list the register as a map of file to slot array, add a slot, append a tombstone — and producers inject their own payload through a declaration-merged detail map. The shipped write capture rides it as the git-work-tree snapshot producer; the new line-note feature rides it as the comment producer; the `@` pipeline, the editor gutter, and the Changes cycler all resolve addresses by filtering the one register instead of folding five bespoke readers. PR1 of this note — the register itself, its worktree producer, and its remotes — is implemented and spec-covered in `packages/fs/checkpoint` as of this writing.

In product terms, three things ship:

- **Line notes.** Hover a line, click the `+` in the gutter column left of the line number (the GitHub-diff comment idiom), write the note; the line's text freezes with it, so the note keeps pointing at exactly what was meant after the file changes. `@`-mentioning the note chips it in the composer, and sending puts the note plus the frozen line into the agent's next request. The [interactive mock](./2026-10-08-line-anchored-editor-notes-as-prompt-snapshots.mock.html) shows the whole loop on the shipped dark chrome, and the [demo recording](./2026-10-08-line-anchored-editor-notes-as-prompt-snapshots.mock.gif) runs hover → popover → `＋` quote → inline chip → send end to end.
- **The finished "what did the agent touch" surface.** Each agent turn closes with a chip row of the files it changed with `+n −n` badges and click-through to the frozen diff; typed `@` snapshot mentions expand at submit; sent messages show snapshot chips; the editor grows change markers; the retired Files tab collapses into these surfaces.
- **One durable register underneath.** Notes and work-tree captures persist per session on the host, survive restarts, and appear identically in a second client of the session; future producers (manual pins, workspace rescans) join by declaring a detail-map member, not by forking storage or UI.

The session log stays out of the register entirely: slots are store rows, not events, and no event is proposed. `Session.append` builds its envelope itself and offers no writer path for the envelope-level `ignorable` marker, so the earlier draft's key-ping index event would have required a `dsh-session` surface change before the feature needed one; the register needs no such event, and live refresh rides the session binding's revision bump that already re-derives the `ui-file-history` fold today. If a true key-ping event later proves worth the core change, its mechanics are a `dsh-session` decision record of their own; the register is unchanged by it either way.

## The slot register

`dsh-checkpoint/types.ts` grows the slot core beside `CheckpointRow`; the store persists one row per mutation under `<dshHome>/checkpoints/v1/<sessionId>/slots.jsonl`, append-only, surviving crashes like the blob store does. The core carries the generic scopes and what a generic UI renders; per-producer payloads ride a declaration-merged map so both planes compile against it without the service knowing any producer.

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
  /** Optional turn scope; the remote fold joins `tool/call` for absent turns. */
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
  /** Per-producer payload; an empty object for kinds that need none today. */
  readonly detail: Readonly<Record<string, unknown>>
}

/** Per-producer payload; declaration-merged like SessionEventMap. */
export interface CheckpointSlotDetailMap {
  /** A line the user pinned; the comment producer. */
  readonly note: { readonly text: string }
  /** A committed write the capture gate recorded; slotId reuses the call id. */
  readonly worktree: { readonly toolName: string }
}

/** One file's live slots over the remote surface, oldest first. */
export interface CheckpointSlotTimeline {
  /** Session-relative path, slash-separated. */
  readonly path: string
  readonly slots: readonly CheckpointSlot[]
}
```

The register is undeletable: `putSlot` and `releaseSlot` are its only mutations and both append; no host or remote method removes or rewrites a row. Releasing a note appends a tombstone row that folds to absent in every view while the put row itself stays in the log, so a mention that raced into a `user/message` still resolves afterward. Provenance is producer-honest: the worktree producer mints `slotId` from the tool-call id and stamps `callId` with the same value, so the shipped `@path#turn#call-id` grammar resolves by filtering the register, and the note producer mints `note-<12 hex>` ids the new `#L<line>#<note-id>` grammar names.

`CheckpointService` hosts the surface where `captureWrite` already lives — a public method pair for host callers, plus typed Remotes in the `checkpoint` namespace the api-remotes client assembly already mounts:

```ts
export class CheckpointService extends TypertRemoteService {
  /** Host producers call this; rejects on bound or duplicate-id violations. */
  putSlot(session: Session, slot: {
    readonly slotId: string; readonly kind: string; readonly path: string
    readonly label: string; readonly turn?: number; readonly callId?: string
    readonly line?: number; readonly before?: SnapshotDigest; readonly after?: SnapshotDigest
    readonly retained?: string; readonly detail?: Readonly<Record<string, unknown>>
  }): Promise<CheckpointSlot>

  /** Append the tombstone; the only hide mechanism, idempotent. */
  releaseSlot(session: Session, slotId: string): Promise<void>

  /** The register as a file-to-slot-array map, tombstones folded. */
  @Remote('slots')
  slots(session: Session, path?: string): Promise<CheckpointSlotTimeline[]>

  /** The Web producer path; the same append with byte bounds enforced. */
  @Remote('slotPut')
  putSlotRemote(...): Promise<CheckpointSlot>

  @Remote('slotRelease')
  releaseSlotRemote(...): Promise<void>
}
```

`retained` strings are hashed with `digestOf` into the existing per-session blob store at put time — the worktree producer's before/after blobs keep living exactly where they live today, ref-wise unchanged — so only digests ride the row and the blob store's no-prune posture covers both kinds. Config gains `maxLabelBytes` and `maxRetainedBytes`, triple-declared with schemastery and wired in `packages/bundle/base/cordis.patch.yml` (`2048` and `8192`) — no `DEFAULT_*` constants, per the no-hardcoded-tunables rule. `putSlot` rejects its caller on bound violations and duplicate ids, the opposite of `captureWrite`'s observation posture: a producer's put is a request, not an observation.

The register is data, not wiring: `putSlot` is a runtime write against a per-session store whose lifecycle the session already owns, so the registrations-are-effects invariant is untouched — nothing here is a contribution, and there is no disposer to forget. The merged detail map is the only compile-time seam, and it extends by declaration like `SessionEventMap`, not by runtime registry.

## The producers

**The git-work-tree snapshot producer.** The shipped capture is the register's first producer with the smallest possible delta: where `retainWrite` writes its row today it additionally calls `putSlot` with `kind: 'worktree'`, `slotId = callId` and the same `callId`, `label` the purpose (or the tool name), `before`/`after` the digests it already holds, and `detail.toolName`. The write gate, the blob writes, and `dsh-tool-fs` are untouched; `checkpoint/scan` keeps emitting through the retirement window below, then the `stops` remote retires in the PR whose last consumer moves.

**The comment producer, `@deepseek-ai/dsh-client-ui-line-note`.** With a generic host surface the new feature is one browser plugin at `packages/client/ui-line-note/` and zero new host packages. It owns the popover (HoverCard chrome from `ui-primitives`), writes via the `slotPut` remote with `kind: 'note'`, `line`, `label: text`, `retained` the line's current text, and reads the marker state from the register. The gutter composes through a keyed slot `ui-editor` adds beside `sidebar.right.pane.tab` — `editor.cm.extension`, currency `(file) => Extension` — so the note gutter is a CodeMirror `gutter()` extension composed by the slot, not a fork of `createEditorExtensions`; the read-only text preview gets the same `+` hover through a second contribution, its `?line=` anchor untouched. Cleaning a note up is `slotRelease`: the marker and chips disappear, the rows stay.

## How the Web plane reads the register

The DOM reads the register through the react-free store idiom the client already owns: `@deepseek-ai/dsh-client-store`'s `ObservableSnapshot`, one memoized per session binding, exactly the pattern `dsh-client-ui-file-history` builds over `binding.eventSource` today (WeakMap of sources, fold re-keyed on revision). The slot version re-fetches `remote.checkpoint.slots` when the binding's revision bumps, so gutter markers, the Changes cycler that pages one file's worktree slots, the turn-tail chip row, and the `@` picker all read one store — one source of truth, four projections, no per-view fetches. Register state is store-only, so the fold is correct on a cold open and in a second client; the revision bump only bounds its staleness.

## The line-note and `@` consumer seams

The `@` pipeline's existing data-source seam absorbs the register: `ui-reference` awaits `slotsRemote(sessionId)` beside the stop fold during the window, filters `kind: 'note'`, ranks with the same `rankByName`, and emits candidates with mention `@<path>#L<line>#<note-id>` (a new `parseNoteRef` in `ui-primitives/snapshot-ref.ts`; the shipped `parseSnapshotRef` stays untouched, path still everything before the last two `#`). Addressing a worktree slot keeps the shipped grammar and resolves by filtering the same map on path, turn, or call-id. `ReferenceInsert.appearance` in `ui-conversation/src/client/contract/input.ts` grows `'note'`, and `ReferenceIcon`'s closed switch grows the pencil case, the compiler naming every missed site. `codec.serialize` inlines `${ref}\n${text}` plus the fenced frozen line read through `checkpoint.blob(after)` — the codec resolves the digest to raw text at serialize time and only there, erroring verbatim when absent, as the shipped stop codec does.

## Takeover of the in-flight checkpoint stream

The sibling note `2026-10-07-in-editor-changes-display-and-files-view-retirement.md` owns the shipped-and-remaining changes-display stream. Shipped baseline: the write-gated capture bracket, the blob store, `checkpoint/scan`, the `blob`/`restore`/`stops` remotes, the `FileStop` fold, the `@`-menu stops, the editor Changes entry, the frozen serialize, and session-relative paths (`c632bfbd44`, `9f0e736ee7`, `e1fd7cae32`, `306297bd31`, `53879c9aa5`). The stream's remaining work moves here and is refactored onto the register instead of finished against the stop fold; each task names its plugin and its refactor.

**T1 — worktree producer rides the register (host).** Done in this note's PR1: the `captureWrite` delta named above; `checkpoint/scan` dual-emits until every consumer reads the register, then `stops` retires with its callers already relocated.

**T2 — the chat chip row (stream step 3, `dsh-client-ui-chat`).** The row renders once at each agent turn's tail, where the chat view's node renderer closes the turn; the keyed surfaces it rides are declared in `packages/client/ui-chat/src/client/contract/slots.ts`. Chips come from the register restricted to the turn instead of raw stops, so note and pin kinds ride the row for free; per-file `+n −n` is the shipped client-side `frameDiff` over the two `blob` reads, unchanged for worktree slots. Chips use the shipped inline-reference treatment (teal code text, hover title the mention, click `openFile` with `{ display: 'changes', stop }`), copy is locale-owned in the ui-chat dictionary, and specs cover chips, idle turns, and click-through. The binding's revision bump re-fetches the register and re-derives the tail row as writes land.

**T3 — typed `@` tokens expand at submit (diagnosed regression).** Chips serialize through `serializeReference` but a typed `@path#turn#callId` TextRefNode does not; the fix wires TextRefNode tokens through the same codec at submit in `ui-input-trigger/src/client/controller.ts` against the `ui-conversation` input facade, with `input-reference-submit.client.spec.ts` as the spec home. The refactor: the codec's snapshot branch resolves through the same register read T2 uses, so typed stops, chips, and note mentions share one resolution path, and the composer scan (`ui-conversation/src/client/input/decorations.ts`, `TEXT_REF_RE` already admits `#` tails and gains the `#L<line>#<note-id>` form) feeds all three.

**T4 — sent-message snapshot chips (`dsh-client-ui-primitives`).** `projectUserText` in `user-text.tsx` decorates a sent `@path#turn#callId` with the plain file kind — its `referenceKind` derivation branches on quote and trailing slash only — so add a `snapshot` kind that detects the `#` tail, renders the clock icon, and opens on click at the stop, and give the note mention the pencil through the same branch. `user-text.client.spec.tsx` grows the cases.

**T5 — Changes tick hover card (`dsh-client-ui-editor`).** The scrubber tick's hover/focus card shows the tool name and `+n −n`; counts stay derived client-side via `frameDiff` over `blob` reads, the name read from `detail.worktree.toolName` off the register with no stop mirror.

**T6 — source-mode gutter and overview markers (`dsh-client-ui-editor`).** Change markers in the code gutter and overview ruler derive from the register lineage (`useFileHistory` merge today, the slot store after T1). They arrive as another `editor.cm.extension` contribution from `ui-editor` itself, sibling to the note gutter the `ui-line-note` plugin contributes — one composed gutter stack, two providers, proving the slot's currency.

**T7 — Files view retirement (stream step 5, `dsh-client-ui-file-history`).** Delete `FileHistoryView.tsx`, `views.module.css`, the `conversation.view` registration in `src/client/index.ts` (id `file-history`, order 20), and the `view.files` locale key; keep `fold.ts` and the `fileHistory` hook provider through the retirement window, then `fold.ts` becomes the thin projection of `remote.checkpoint.slots` onto the `FileStop`-compatible shape the surviving consumers still type against. Regenerate the client slot catalog with `gen-client-catalog`, and replace or adjust the package spec that exercises the removed view.

**T8 — verification and landing.** Typecheck both compiler faces; run the targeted suites under `test:coverage`'s per-file gate; `verify-client-ui-i18n`, `verify-export-jsdoc`, `duplication`; `build:lib` + `build:web`; restart `dsh web` and verify stops, chips, and markers in a real browser on a session that writes; commit and push per the stream's landing posture.

## Sequencing

PR1 (this turn) is the register on `dsh-checkpoint` itself: vocabulary, store rows, service surface, remotes, worktree producer, config bounds, specs, and README — green at `packages/fs/checkpoint/tests` with the package's coverage posture. PR2 adds `ui-editor`'s `editor.cm.extension` slot, `ui-line-note`'s gutter, popover, and preview hover, the slot store hook, plus T2, T5, and T6. PR3 adds the `@` appearance, source, and codec plus T3 and T4. PR4 lands T7 with the browser expectations under `apps/web/tests/expected/` on session-driven replay, T8's gates closing each PR. PR2–3 deliver the hover → note → quote → fix loop; a follow-on note owns any further producer (the unwired `walkWorkspace`/`gap` rescan decls are the obvious candidate) without touching anything here.

## Alternatives considered

**Finishing the in-flight stream against the stop fold, no register.** Every remaining task is one more bespoke reader of `stops`: the chip row, the tick card, the markers, the `@` source, and then the note feature as a sixth. The stream's own step list already folds the same rows in four client sites; adding the note there makes five folds over one store, which is the duplication the register exists to prevent.

**A key-ping session event beside the register, an earlier draft.** The envelope's `ignorable` marker has read and restore support but `Session.append` exposes no writer path for it, so the ping would have required a `dsh-session` envelope change before the feature needed one, and `checkpoint/scan` already pings the shipped chip fold for the interim. The register reads without any event; the ping question reopens only if refetch-on-revision proves too coarse.

**A consumer package with verbatim log payloads (`dsh-line-note`, an earlier draft).** Log-retained payloads and a bespoke service are the right mechanics for feedback, but they promote one producer's UI state into the event vocabulary and make every reader of the log learn the feature. The store is the body, and the general surface outlives the first producer.

**A required-on-read `checkpoint/slot` event with an in-service producer registry, an earlier draft.** It rewrote the shipped `checkpoint/scan` fold, generalized events for hypothetical producers, and put a runtime registry where Cordis composes at the loader. The store-keyed register keeps writes as data calls (the `captureWrite` idiom) and the extension seam as a declaration merge.

**Delete semantics on the register.** A remove-row API would break replay-correctness for mentions that already serialized, and would tempt view cleanup into history rewriting. Tombstones keep the log append-only and the views clean at once.

**Adding a kind field to `CheckpointRow`.** Rows' mandatory write-call identity and before/after write-gate contract make that a provenance falsification; slots are a sibling row family in the same store, not a mutation of rows.

## Open questions

- Whether the gutter control doubles as a right-click line menu: `EditorBody` mounts no `onContextMenu` and the dock file menu is file-scoped; the mock keeps one left-click and defers the menu.
- Fork inheritance: the checkpoint store's fork behavior is whatever `dsh-checkpoint` defines for blobs today; slots inherit it, and a fork that copies slots but not blobs would dangle digests — settle with the store owner in PR2.
- Resolved-note folding in the `@` picker (list as open only notes whose frozen line still differs from the file's current line) needs a cheap current-line read per candidate; defer if the picker's latency budget rejects it.
- Live-update frequency: refetch-on-revision bounds staleness at the same grain the shipped fold uses; a session with a write storm between paints may want a delta Remote — measure in PR2 before adding one.
- Pruning: undeletable means released rows and blobs accumulate until a retention design names a root set; the same posture as blobs today, named now so no one mistakes the absence for oversight.

## Acceptance criteria

- `putSlot` persists a row keyed per session and file; `slots` lists the live map after host restart with no session event present in the log, and identical in a second client of the session; no shipped API removes or rewrites a row, and a released note's put row still resolves for the codec.
- Hovering or keyboard-focusing a line shows `+` gutter-left of the line number; submitting a byte-bounded note writes a `note` slot and the gutter shows `✎` from the register, including in a second browser client of the same session.
- The turn-tail chip row renders worktree and note slots per turn with per-file `+n −n` and click-through to Changes; a typed `@path#turn#callId` token expands at submit exactly as the chip does; sent messages show snapshot chips with the clock icon and note chips with the pencil.
- `@<path>#L<line>#<note-id>` chips render inline with the pencil glyph; sending serializes address, note text, and fenced frozen line resolved through `blob`; the recorded `user/message` alone reconstructs the request text.
- The Changes cycler pages one file's worktree slots off the register; the tick card names the tool and counts; source-mode gutter and overview markers track the same lineage; the Files conversation view is gone with its locale key and catalog entry regenerated, `fold.ts` surviving as the projection until `stops` retires.
- `releaseSlot` appends its tombstone, removes marker and chips, and leaves both rows in `slots.jsonl`.
- Gates green per PR: `verify-config-catalog` and `verify-cordis-config` for PR1's config bounds, `verify-client-catalog` where the client moves, `doc-sync`, `verify-client-ui-i18n` for PR2 onward, per-file 100% coverage on touched `src` files; `apps/web/tests/expected/` covers gutter, popover, chip row, and serialized chip on session-driven replay in PR4.

## Risks

- Store-as-body means a session log copied without its `<dshHome>` checkpoint directory loses note bodies; serialized messages that already raced into `user/message` survive, the authoring surface does not. Recorded in the checkpoint README's Known Limitations.
- The takeover widens PR2's blast radius: four in-flight surfaces move onto the register in one window while `checkpoint/scan` still dual-emits. Mitigated by slotId-equals-callId dedupe and by retiring `stops` only after every consumer has moved.
- The register's write posture splits: `captureWrite` swallows store failures like today, while `putSlot` rejects, so a plugin observes its own put failure instead of losing a note silently.
- Undeletable by design, the register grows per session; the pruning posture is named in Open questions rather than shipped half-formed.
- Untended notes outlive their fix and clutter the gutter and the `@` picker; the open/resolved split is a follow-on, not a blocker.
- Every label rides locale dictionaries; the mock's strings are placeholders, not ship copy.
