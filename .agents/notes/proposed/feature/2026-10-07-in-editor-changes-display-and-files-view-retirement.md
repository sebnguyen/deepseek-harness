# Agent Note: Changes inside the editor — turn scrubber, unified diff, `@` snapshot addresses, and Files view retirement

Status: proposed

Companion design record for the presentation fixed in [delta-aware workspace snapshots](./2026-10-07-delta-aware-workspace-snapshots-and-critique-timeline.md); [the viewable mock](./2026-10-07-delta-aware-workspace-snapshots-and-critique-timeline.mock.html) is shared. The workspace snapshot timeline (PRs 1–3 shipped: capture bracket, blob store, `checkpoint/scan`, `blob`/`restore` remotes, `FileStop` fold) gains its CodeMirror half inside the base editor and retires the Files conversation view that carried the first presentation. The stream's remaining client work — the turn-tail chat chip row, the typed-`@` submit expansion, the sent-message snapshot chips, the tick hover card and source markers, and this note's Files view retirement — is taken over by [the line-anchored editor notes note](./2026-10-08-line-anchored-editor-notes-as-prompt-snapshots.md) as tasks on its slot spine; this note stays the design record for the shipped Changes display, its `@` grammar, and the chip-row presentation.

## Problem

PRs 1–3 of the [delta-aware snapshot note](./2026-10-07-delta-aware-workspace-snapshots-and-critique-timeline.md) shipped the capture, store, and fold — but the only shipped presentation is the Files conversation view: a file list, a native range slider, and a timeline the base editor never sees. The base editor's only history affordance remains a file reload; a freeze-frame diff, the stop's stated purpose, and the critique target all live one tab away from the code they describe, and the `@` reference surface that already resolves files and sessions has no member for "the way this file was". Two surfaces now draw the same data in two dialects, one of which is already drowned in information by the dockkit chips.

## Proposal

The editor's Changes display is a third `EditorDisplayMode` beside `edit` and `preview`. Its identity is the session-standard `useFileHistory` hook (merged into `SessionStandardProps` by `dsh-client-ui-file-history`, props-borne, type-only edge — feature plugins never runtime-import each other). The display top is a continuous turn-proportional scrubber — a 24px layer-2 band whose end labels are `turn 1` and the session's current turn, a 2px track with 2×10px ticks at each stop of the open file (gap rows a warn-stroked diamond) and a draggable playhead (1.5px business hairline, 11px round handle) that snaps to the nearest stop; a dashed ghost child previews the fractional turn mid-drag. The axis is turns, not wall time: dead time carries no information and turn numbers are what the log's identity stack prints. Hover or focus on a tick opens a tight card — tool name, then `+n −n` side by side; the gap diamond labels itself `unattributed`. Selecting a stop renders one frozen single-page unified diff of the stop against its predecessor (`@codemirror/merge` unified view; sides never rebase under the live doc, VS Code freeze semantics). The display bottom holds the stop's purpose box (`Purpose` heading, `turn N · tool · callId` meta, stored text full) with a round left-aligned `＋` that loads the stop's `@` address chip plus the cited purpose into the main composer's next draft.

Critique rides the one conversation: the `@` chip and quote travel in an ordinary user turn; no second chat element exists anywhere. As each agent turn ends, its message closes with a snapshot-chip row drawn from the turn's frame: every file whose state differs between the turn-start and turn-end snapshots renders one inline chip in the shipped inline-reference treatment — teal code-face text reading filename `+n −n`, 6px radius, no fill until hover — the hover title carrying the full `@path#turn#call-id` of the turn-end stop and a click snapping the Changes playhead there. The badges are the frame diff — client-side `structuredPatch` over the two `blob` reads, the same pure diff the frozen view uses — so a turn where three calls touched one file shows one chip and an idle turn draws a dim no-changes line. A gap row inside the frame rides its chip as a warn diamond, without losing the aggregate. No new session event: `frameForTurn` reconstructs both halves from rows plus the log's turn bracket. The addresses are the same strings the composer mints, so a mention chip, a picker row, and a critique chip are one grammar.

### The seat draws what the chrome already draws

The chip rows bring no chrome of their own: they sit inside the transcript the conversation already draws. Tool calls render with the shipped DisclosureRow chrome (12px disclosure chevron, name in label-secondary, purpose ellipsized in tertiary, uncolored 11px code `+N -M`) and each turn groups its rows on a 2px inset rail ending in the turn's chip row; user turns stay right-seated violet bubbles with no author line. Transcript and composer sit at the shipped centered measure (`min(column 64%, content size × 37)`, the card `+32px`, `ConversationRoot.module.css:35-45`); the composer keeps its 22px elevation-soft card, 28px selector circle, and 34px send circle; the @ picker uses the shipped menu metrics (20px shell, 10px rows, elevation-prominent with an l1 stroke). The session sidebar carries the brand row — the expanded New Session shortcut, pointer its sole affordance — straight into the session list; no standalone New Session bar. All literals are the dark values of `design-platform.css` (bluish layers, deepseek-300 business, white-alpha l1-l4 hairlines, `rgb(65,74,75)` tooltip), quoted in the mock rather than invented.

## Data structures

The stop's address is the log's own identity stack — path, turn, tool-call id — with `#gap` in the turn slot exactly when `FileStop.turn` is absent (`packages/client/ui-file-history/src/client/fold.ts:12`): `@scan.ts#4#call-7f2`, `@scan.ts#gap#call-5e0`. `callId` is the key; turn is display order.

```ts
// packages/client/ui-primitives/src/client/snapshot-ref.ts (new)
import type { ToolCallId } from '@deepseek-ai/dsh-llm'

/** One snapshot address: path, turn (or 'gap'), tool-call id. */
export interface SnapshotRef {
  readonly path: string
  readonly turn: number | 'gap'
  readonly callId: ToolCallId
}

/** Parse `@`-less form `path#turn#call-id`; undefined on any malformed part. */
export function parseSnapshotRef(ref: string): SnapshotRef | undefined

/** `${path}#${turn}#${callId}`; round-trips parse. */
export function serializeSnapshotRef(ref: SnapshotRef): string

/** The stop a ref names; callId alone keys a FileStop. */
export function findStop(ref: SnapshotRef, stops: readonly FileStop[]): FileStop | undefined

/** One turn's snapshot frame, reconstructed from rows alone:
    start is each path's earliest-row `before` in the turn (or the
    previous turn's last `after`), end its last-row `after`. */
export interface TurnFrame {
  readonly turn: number
  readonly start: ReadonlyMap<string, SnapshotDigest | undefined>
  readonly end: ReadonlyMap<string, SnapshotDigest | undefined>
  readonly broken: boolean   // any row inside the frame carries `gap`
}
export function frameForTurn(stops: readonly FileStop[], turn: number): TurnFrame
```

The capture side walks the turn bracket one step wider: the first `tools/execute` bracket of a turn rescans *before* dispatch when the session holds no scan yet for that turn (the turn-start frame half); the shipped post-dispatch scans keep minting stops, and the turn's last scan is the frame's end half.

The promotion of `ui-editor`'s appearance-following assembly (token theme, highlight style, language registry) to `dsh-client-ui-primitives` carries the frozen view:

```ts
// packages/client/ui-primitives/src/client/changes.ts (new)
import type { Extension } from '@codemirror/state'

/** What the frozen Changes view draws for one selected stop. */
export interface ChangesFrame {
  readonly ref: SnapshotRef
  readonly beforeText: string | null  // null on first-appearance or gap rows
  readonly afterText: string
  readonly added: number            // from FileStop's stored badges, never re-diffed
  readonly removed: number
}

/** Read-only CM6 face: shared editorTheme + editorHighlight, no save command. */
export function changesEditorExtensions(language: Extension | undefined): Extension

/** Mount the unified view; destroy() tears the EditorView down (HMR hygiene). */
export function createChangesView(parent: HTMLElement, frame: ChangesFrame): { readonly destroy: () => void }
```

## Editor interface

```ts
// packages/client/ui-editor/src/client/EditorBody.tsx (diff)
export type EditorDisplayMode = 'edit' | 'preview' | 'changes'

export interface EditorInjected {
  readonly load: /* unchanged */
  readonly save: /* unchanged */
  /** Frozen side texts; null answer renders the locale-owned missing-blob notice
      and the chip's invalid state, never a crash. */
  readonly blob: (digest: SnapshotDigest, signal: AbortSignal) => Promise<string | null>
  /** Restore one stop (the controls-row Revert); returns the new version. */
  readonly restore: (path: string, digest: SnapshotDigest, signal: AbortSignal) => Promise<string>
}
```

`EditorBodyProps` already extends `PropsRuntime<'sidebar.right.pane.tab'>`, so `props.useFileHistory` is present; the body derives `stopsFor(file.path)` (type-only `FileStop` import) to drive the scrubber, the segment icon (±, disabled when zero stops), and commit-on-leave buffer semantics identical to the existing mode swaps. The face (`packages/client/ui-editor/src/client/index.ts`) gains `remote.checkpoint` to its inject list and builds `blob`/`restore` there; the view registers nothing new.

## `@` addressing

The reference surface is contribution-fed: `packages/client/ui-input-trigger/src/client/controller.ts` aggregates a per-trigger lexicon from sources exposing an optional `lexicon` hook and routes chips through each source's `openReference`; `dsh-client-ui-reference` (`packages/client/ui-reference/src/client/index.ts:46`) owns the `@` trigger, its `candidates`/`onPick`/`codec` today cover files and sessions. Three additions make snapshots first-class members of that source:

```ts
// packages/client/ui-reference/src/client/index.ts (diff)
const source: InputTriggerSource = {
  trigger: '@',
  // Sold by files and sessions rows; stop rows nest under their file section
  // as '@path#turn#call-id', labelled `${name} · ${tool} · +n −n`.
  async candidates(session, req) {
    const [fileItems, sessionItems] = await lookup(req)              // shipped
    const stops = await ctx.remote.checkpoint.stops(session.sessionId, req.query, signal)
    return [...fileItems.map(...), ...stopRows(stops), ...sessionItems.map(...)]
  },
  // Picker pick mints the address chip; the ref string is the whole identity.
  onPick({ candidate }) { /* insert { source: 'reference', ref: candidate.mention,
        appearance: candidate.kind === 'stop' ? 'snapshot' : ... } */ },
  // Lexicon feeds the editable text-ref scan so a typed address is a token.
  lexicon: session => [...fileRoll, ...stopRoll(session)],
  openReference(_session, { ref, appearance }) {
    if (appearance !== 'snapshot') return shippedFileBranch(ref)     // unchanged
    return ctx.sidebarRight.openEditorTab(ref, {
      display: 'changes', stop: parseSnapshotRef(ref)!.callId,
    })                                                          // playhead snaps
  },
  codec: {
    clipboardText: ref => ref,
    // Submit-time inline: pruned or missing stops fail loud as invalid chips.
    serialize: ref => serializeSnapshotRefForModel(ref),
  },
}

async function serializeSnapshotRefForModel(raw: string): Promise<string> {
  const ref = parseSnapshotRef(raw)
  if (ref === undefined) return raw                              // plain @file
  const stop = findStop(ref, await fileHistory(ref.path))
  if (stop?.after === undefined) throw new ReferenceInvalidError(ref)
  const text = await checkpointBlob(stop.after)
  if (text === null) throw new ReferenceInvalidError(ref)          // pruned blob
  return text                                                   // like a file read
}
```

`packages/client/ui-conversation`'s `scanTextRefs` name class widens by `#` (`input/decorations.ts`) so `scan.ts#4#call-7f2` typed after `@` matches once the lexicon names it; the submit serializer the input contract drinks (`serializeReference`, `packages/client/ui-conversation/src/client/contract/input.ts:136`) routes to the owner's `codec.serialize`. Being one source's codec keeps model-visible ⟺ logged on the existing path: the displayed chip and the model's cited snapshot text derive from the same ref string.

## Plugin config

Host side keeps the shipped `Config` (`packages/fs/checkpoint/src/index.ts:38`) and gains the retained knobs the presentation depends on (interval ladder and retention from the parent note's PR7):

```ts
export interface Config {
  enabled?: boolean            // shipped
  pruneExtra?: string[]        // shipped
  dshHome?: string             // shipped
  /** Capture ladder; 'event' keeps one scan per mutating-call bracket. */
  interval?: 'event' | 'turn'
  /** Stops retained per file before blob pruning; pruned refs fail loud as invalid. */
  retentionStops?: number
}
```

```yaml
# web-profile cordis.yml (additions)
plugins:
  - name: '@deepseek-ai/dsh-checkpoint'
    config:
      enabled: true
      interval: event
      retentionStops: 40
      pruneExtra: [dist, coverage]
  # dsh-client-ui-reference and dsh-client-ui-editor stay on the shipped
  # roster; useFileHistory reaches both through session-standard props, so
  # the composition lists no new cross-plugin edges.
```

## Files view retirement

The `dsh-client-ui-file-history` conversation view (register at `packages/client/ui-file-history/src/client/index.ts:70`, id `file-history`, order 20) is deleted: `FileHistoryView.tsx`, `views.module.css`, the `view.files` locale key, and the `conversation.view` registration. What survives is the data face the rest of the product consumes: `fold.ts` (`FileStop`, `FileTimeline`, `foldFileHistory`, `UseFileHistory`), the session-standard `useFileHistory` merge, and the `fileHistory.hooks` standard-prop resolver. Its two remote consumers move to `dsh-client-ui-editor`'s face (`blob`, `restore` above); the Files tab's file list collapses into the dockkit chips, its slider into the turn scrubber. Removing a shipped conversation view is a surface removal, not a data migration: no session event changes, `SESSION_FORMAT_VERSION` untouched.

## Alternatives considered

- **Side-by-side `MergeView` panes** (the parent note's first target): two CodeMirror panes driven by `@codemirror/merge` render the same hunks the unified view shows, at double the width of a 620px panel; the single-page unified diff keeps both number columns in one gutter instead.
- **Wall-time-proportional axis** (family 1 pure): dead time between turns dominates the band and strands sparse stops at one pixel; turn-proportional keeps every tick legible and prints the same numbers as trajectory and the log's identity stack.
- **Floating `_dsh_harness_purpose` window and left-rail timeline** (earlier mock generations): a floating card over the diff occludes it and reads as a second chrome; the left rail trades horizontal diff width for a list a 24px spine conveys.
- **Second chat element beside the main conversation** (transcript dock, composer duplicate): two chat seats side by side fought for the user's typing focus; the `@` address plus main-composer flow keeps one element.
- **Open-ended `#stop-N` sequence address**: the per-file scan sequence is a projection detail that renumbers nothing but teaches a new syntax; `#turn#call-id` is the log's own key and self-explaining.
- **File list as its own conversation view (the shipped Files tab)** minus the editor Changes: the view duplicated dockkit's open-tab model and its slider a scrubber the editor already needs; retention pays a third surface for data two others render.

## Acceptance criteria

- Opening a tab with stops offers Source · Changes icons (Preview where the path claims a rendered display) in the controls row; Changes mounts the unified view whose text equals two consecutive `blob` reads of `before`/`after`.
- The scrubber's end labels equal the file's first stop's turn and the session's current turn; dragging shows the ghost; release lands the playhead on the nearest tick and swaps the frozen diff without remounting the scrubber.
- Typing `@scan.ts#` in the composer lists the file's stops; Enter on a row inserts an atomic chip whose ref round-trips `parseSnapshotRef`; sending with the chip puts the stop's `after` text into the model context (asserted at the `serializeReference` seam against a fake blob store).
- A pruned blob renders the chip invalid with locale copy, in the draft and in the posted transcript; a chip click on a snapshot ref opens that file's Changes with the playhead snapped.
- Every agent turn message ends with a chip row over the turn-start vs turn-end snapshot frame: one inline chip reading filename `+n −n` per changed file (a multi-call turn, one chip; an idle turn, a dim no-changes line); a warn diamond marks a frame containing a gap row; clicking a chip opens the turn-end stop in Changes with the playhead snapped.
- The Files tab is absent from `conversation.view` (registry dump plus absence test), `dsh-client-ui-file-history` still exports `foldFileHistory`/`UseFileHistory`, and outside-the-view consumers of `useFileHistory` compile unchanged.
- `verify-client-packages`, `verify-package-dependencies`, `verify-client-ui-i18n` green; 100% per-file coverage across every touched package.

## Risks

- **Pruned blobs under live refs**: a `serializeReference` that throws on a pruned digest must surface as the chip's invalid state with locale-owned copy, never as a silent draft-level failure; retentionStops is the tuning that keeps the common case warm.
- **Gap rows have no turn**: the `#gap` slot is a format constant, not a decoder fallback — every consumer of `parseSnapshotRef` must accept it, and the playhead must place such stops sensibly on a turn axis they are not keyed to. Under the write-gated capture the host never mints gap rows; the diamond stays in the grammar for logs captured before the gate.
- **Removing a shipped view regresses discoverability**: the Files tab is currently the only surface listing everything a session touched; the scrubber is per-file, so restore and selection flows need the dockkit/`useTabInfo` routes to remain complete.
- **Turn-proportional axis with many stops per turn**: turns that hold several stops collapse ticks together; hover hit targets keep 16px width by drawing on a sub-tick spread inside their turn, capped before overlap.

## Assembly order

1. `dsh-client-ui-primitives`: promoted editor assembly, `snapshot-ref.ts`, `changes.ts`, `@codemirror/merge` dependency, locale keys for the display and the scrubber captions.
2. `dsh-client-ui-editor`: `changes` mode, scrubber, purpose box, controls-row icons, face `blob`/`restore` on `remote.checkpoint` (type-only `dsh-checkpoint` edge). PR4 in the parent note lands here.
3. `dsh-checkpoint` (host): capture is write-gated — `dsh-tool-fs` hands each committed write's before/after text to `captureWrite`, one row per written file, no stat-walk; the presentation adds a `stops(session, path)` remote ordered by log seq feeding the Changes scrubber and the picker; `blob` and `restore` ship.
4. `dsh-client-ui-reference`: stop rolls in the `@` lexicon, `#` in the text-ref name class, snapshot branch of `serializeReference`, `openReference` routing.
5. `dsh-client-ui-file-history`: view removal; PR4 in the parent note lands with step 2.

Each step carries the repository's process weight: 100% per-package coverage, locale dictionaries, HMR disposal tests for every mounted view, package READMEs, `verify-client-packages`/`verify-package-dependencies` green, and both notes updated as facts land.
