# Agent Note: Delta-aware workspace snapshots — per-effect file timeline, restore, and anchored critique

Status: proposed

## Problem

The harness records every tool call in an append-only session log, but it records no *workspace state*. A `write`/`str_replace_editor` call leaves a best-effort pre-image in its result meta (`FsWriteOutcome.before/after`, `packages/fs/fs/src/types.ts:128-144`, rendered through `packages/fs/tool-fs/src/diff.ts:33` and persisted on `tool/result` by `packages/core/agent-loop/src/tool-calls.ts:282-289`), and nothing consumes those pre-images for restoration. A `bash`/`pwsh` call leaves nothing: `ctx.shell` spawns a plain process (`packages/shell/bash-local/src/index.ts`, `packages/subprocess/subprocess-local/src/spawn.ts:646-650`), so `sed -i`, redirects, compilers, and deletions are invisible to every session-facing surface. The only user-facing "Revert" in the client is a file reload (`packages/client/ui-editor/src/client/EditorBody.tsx:248-250`). A repository-wide search confirms no file-history, checkpoint, rewind, or pre-image subsystem exists in `packages/*/*/src`.

Users of agent products now expect three connected affordances, validated by shipped prior art: per-turn/per-effect workspace snapshots with revert (Cursor checkpoints, Cline/Roo Code shadow-git checkpoints, Aider auto-commits [aider.chat/docs/git](https://aider.chat/docs/git.html), VS Code local history [1.66 release notes](https://code.visualstudio.com/updates/v1_66)), a per-file timeline whose stops render the state *and* the diff against the previous stop, and a critique loop where each observed change carries a citable reason and a human rebuttal that folds into the next fixing turn. None of the prior art provides the second and third: VS Code local history is per-file full copies that never see terminal writes; shadow-git agent plugins are snapshot-and-restore only; an npm spike on 2026-10-07 found no package exposing a delta-aware file timeline (verified packages: `@zoytown/dsh-rewind` 0.1.0, `@dsh-undo/rollback-undo` 0.1.0-rc.8, `opencode-checkpoint` 1.0.0, `@abelo9996/snap-back` 0.1.2, `@touchtechclub/pi-oc-rewind` 0.3.0, `minicode-ai` 0.11.1, `rovecode` 0.6.0-beta.1, `@arbor-space/core` 0.2.0 — all shadow-git or journal snapshot/restore; `@jsonjoy.com/fs-snapshot` 4.80.0 is a tree-serialize substrate with no history).

Measurements taken in this repo on 2026-10-07 (2.6 GB workspace; `node_modules` 1.7 GB; `.git` 455 MB) bound the design:

| operation | result |

The sweep is cheap when pruned; the unpruned disaster is a pruning failure, and diff-awareness never removes the sweep — it removes reads, hashes, and stores (git's own diff-aware sweep is slower than a plain pruned walk on the same tree). The hurt multiplier is `mutating calls per turn × sweep cost`, which the interval ladder and declared-delta fast paths below bound.

## Proposal

One capture layer producing immutable change rows, one content-addressed store behind a provider seam, and query/UI layers that derive everything else — state at any turn, stop lists, `+/−` badges, hunks, restore, and critique anchors.

### Rows are the records; states and diffs are queries

The persisted unit is a delta row, one state transition on one path:

```ts
/** One observed state transition of one file. Rows never mutate; restore and fix turns append new rows. */
export interface CheckpointRow {
  turn: number            // session turn the effect is attributed to
  callId: string | null   // the tool call responsible, when attribution is call-exact
  source: 'declared' | 'observed' | 'reconciled'
  path: string            // workspace-relative canonical path
  kind: 'created' | 'modified' | 'deleted' | 'renamed' | 'restored'
  beforeDigest: string | null   // sha256 of the prior content; null for created
  afterDigest: string | null    // sha256 of the new content; null for deleted
  added: number           // line counts for badges, computed once at capture
  removed: number
  renamedFrom?: string    // present when kind === 'renamed'
}
```

Whole workspace states exist only as folds over rows; the slider's "state of file f at turn T" is `afterDigest` of the latest row for `f` with `turn <= T` (or the baseline value), an indexed lookup, never a replay. Consecutive rows on one path must satisfy `row[i].beforeDigest === row[i-1].afterDigest`; a violation means a write escaped observation between the two and renders as a **gap marker** — the delta-typed store is self-auditing where snapshot-typed stores and VS Code local history are silent. Hunks are never stored as truth: on row render, `computeHunkDiffs(blob(beforeDigest), blob(afterDigest))` reuses `packages/fs/tool-fs/src/diff.ts` (`diff@^9`, already a dependency of `tool-fs` and `client/ui-trajectory`), with the same `FileDiff`/`DiffResultView` contract (`packages/core/tools/src/presentation.ts:34,184`) so the client has one diff renderer for tool cards, the timeline, and the editor.

### Session events (no format bump)

New vocabulary follows the ordinary-addition path of the [session log versioning mechanism](../../implemented/architecture/2026-08-10-session-log-version-mechanism.md): declaration merging, JSON-serializable documented payloads, no `SESSION_FORMAT_VERSION` bump, no `ignorable` from first-party writers, `gen-persistence-catalog` + `gen-cordis-catalog` regeneration in the same change.

```ts
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One capture frame's rows; the durable source for the timeline, replay, and the UI. */
    'checkpoint/scan': {
      turn: number
      step: number
      callId: string | null
      source: 'declared' | 'observed' | 'reconciled'
      snapshotId: string        // provider's state token: shadow commit sha or manifest generation
      rows: CheckpointRow[]
    }
    /** A human critique anchored to a row and hunk; threads via parentId. */
    'checkpoint/comment': {
      commentId: string
      anchor: { turn: number; callId: string | null; path: string; rowDigest: string; hunkIndex: number | null }
      parentId: string | null
      body: string
    }
    /** Thread closure so replay reproduces resolved state. */
    'checkpoint/comment-closed': { commentId: string }
  }
}
```

Row payloads hold digests and counts, never content, so the log stays its current size class; blobs live in the store and the log references them (the model-visible-if-ever rule then only concerns the bounded `FileDiff` citations, which carry the standard `truncated`/`total` presentation bounds).

### Capture: `tools/execute` bracket, three delta sources

A function plugin wraps the documented around-dispatch waterfall (`'tools/execute'`, `packages/core/tools/src/index.ts:155`) — every mutation the agent causes passes through it, including plugin tools this repo has never seen, and `Scoped<ToolRuntime>` filtering keeps subagent calls attributed to their own agents. Registrations are effects; a failing scan must never convert a successful tool call into `isError`, so the listener is failure-contained and degrades the checkpoint to the next reconciliation.

```ts
// packages/checkpoint/checkpoint-bracket/src/index.ts
export const name = 'dsh-checkpoint-bracket'
export const inject = { checkpoints: 'checkpoints' }
export interface Config {
  /** Snapshot cadence: per mutating tool call, per shell command, or per watcher event window. */
  interval: 'call' | 'command' | 'event'
  /** Glob excludes, pruned during the walk. Deployment-varying: validated config, not constants. */
  excludes: string[]
  maxFileBytes: number
  retention: { maxRowsPerPath: number; storeBudgetBytes: number }
}
export function apply(ctx: Context, config: Config): void {
  const checkpoints = ctx.checkpoints
  ctx.on('fs/observed', intent => { declaredBuffer.push(intent.agent, intent) }) // dsh-fs widens the payload in this feature
  ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    try {
      if (knownReadOnly(exec.name)) return result
      const declared = declaredBuffer.drain(exec)      // exact paths+content from ctx.fs writers
      const scanned = declared.coversAll
        ? []                                        // no walk needed: writers declared everything
        : await checkpoints.reconcile(exec)          // stat-walk delta vs running manifest
      await checkpoints.record(exec, { rows: [...declared.rows, ...scanned], source: declared.rows.length ? 'declared' : 'reconciled' })
    } catch { /* contained: the next turn-boundary reconciliation catches the gap */ }
    return result
  })
  ctx.on('session', s => s.on('turn/end', () => checkpoints.reconcile(/* attribution: turn */)))
}
```

Declared deltas ride the existing `fs/observed` event (`packages/fs/fs/src/index.ts:68`, emitted after every committed write); this feature widens its payload by `path`, `before`, `after` so any `ctx.fs` writer attributes exactly, for free, with no per-file instrumentation. If the running manifest is current (previous post-scan or baseline), the post-scan of call N *is* the before-image of call N+1, so steady state costs one stat-walk per mutating call — 55 ms pruned in this repo — and read-only calls skip all I/O. `interval: 'command'` additionally brackets `ctx.shell.run`/`start`; `interval: 'event'` switches capture to the chokidar dirty-set (already a dependency in four packages) with each coalesced event window snapshotting only dirty paths, demoting the sweep to periodic reconciliation because watchers drop events under burst and never prove content; inotify descriptor limits and macOS FSEvents directory-granularity are documented behavior of that mode, not defects to fix. Parallel mutating calls that do not declare (two concurrent `bash`) degrade attribution to the turn with a gap marker instead of a confident lie: declared rows win unconditionally, scan rows attach to their window, conflicts fall back.

### The scan core: stat cache, content hashes, content-addressed sinks

The provider keeps a git-index-shaped manifest (`path → { digest, size, mtimeMs, ino }`); the walk stats every non-excluded path, reads and hashes only stat-dirty suspects, stores only unseen digests, and returns rows. Files whose mtime equals the manifest write time are re-hashed (git's racily-clean rule), and files rewritten with deliberately preserved stat data are caught only by `interval: 'event'` — the two capture paths are complementary, and that complementarity is the design's trust floor.

```ts
// packages/checkpoint/checkpoint-local/src/scan.ts
export async function rescan(
  root: string, manifest: Manifest, blobs: BlobSink, cfg: ScanConfig,
): Promise<CheckpointRow[]> {
  const rows: CheckpointRow[] = []
  for await (const [rel, stat] of walkWithStats(root, cfg.excludes)) {   // prunes excluded dir
    const known = manifest.get(rel)
    if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs && known.ino === stat.ino) continue
    const bytes = await readFile(join(root, rel))
    if (bytes.byteLength > cfg.maxFileBytes) { manifest.noteOversize(rel); continue }
    const digest = sha256(bytes)
    if (!known || known.digest !== digest) {
      await blobs.put(digest, bytes)                                  // immutable, deduped, zstd
      rows.push(rowFor(rel, known?.digest ?? null, digest, bytes))    // added/removed via diffLines counts
    }
    manifest.set(rel, { digest, size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino })
  }
  for (const rel of manifest.pathsMissingFromDisk()) rows.push(deletedRow(rel)) // manifest-drop = delete
  return rows
}
```

### Store providers behind one seam

`ctx.checkpoints` is a cordis Service Definition with two v1 providers selected by config:

- **`checkpoint-local` (default):** the manifest above in a `ctx.storage` sqlite domain (`packages/storage/storage-sqlite`), blobs in an attachment-pattern immutable store (`packages/attachment/attachment-local/src/store.ts:25,157` shows sha256 + `0700` object dirs; its API is attachment-shaped, so a sibling object store is the honest addition, ~200 lines).

```ts
// packages/checkpoint/checkpoint-git/src/provider.ts
const matrix = await git.statusMatrix({ fs, dir, gitdir })         // respects the work-tree's .gitignore
for (const [file, head, workdir, stage] of matrix) {
  if (head !== workdir && workdir !== stage)
    workdir === 0 ? await git.remove({ fs, dir, gitdir, filepath: file })
                  : await git.add({ fs, dir, gitdir, filepath: file })
}
const snapshotId = await git.commit({ fs, gitdir, message: `turn=${turn} call=${callId}`,
  author: { name: 'dsh-checkpoint', email: 'checkpoint@local' } })
```

```ts
// Derivation: changed paths between two snapshots, whole-subtree pruning by oid equality
await git.walk({ fs, gitdir, trees: [TREE({ ref: prev }), TREE({ ref: curr })],
  map: async (filepath, [a, b]) => {
    if ((await a?.type()) === 'tree')
      return (await a?.oid()) === (await b?.oid()) ? null : undefined   // null prunes the subtree
    const [oidA, oidB] = [await a?.oid(), await b?.oid()]
    return oidA === oidB ? null : { filepath, oidA, oidB }               // undefined side = create/delete
  } })
```

The git provider's ignore handling is policy, not mechanism: `.gitignore` is honored (private files never enter our store) at the price of ignored outputs being unrevertible, stated in the provider's README; `excludes` config is the override. Both providers satisfy the same interface — `snapshot(bracket)`, `stops(path)`, `stateAt(path, turn)`, `numstat(turn)`, `content(path, turn)`, `prune()` — so provider choice never reaches the UI.

### Roots and scoping

Snapshot roots reuse `SandboxExecutionPolicy.workspaceRoot` (`packages/sandbox/sandbox-policy/src/index.ts:147,194`, per-session via `session.header.cwd`) — one home for "the workspace", no second root concept — and deliberately exclude `writableRoots()`' temp members (`packages/sandbox/sandbox/src/roots.ts:52-54`), so "bash writing `/tmp` is not restorable" is a documented limitation in the VS Code terminal-blindness class, not a bug.

### Restore: apply = append

Applying a stop never truncates history: the restore tool reads the stop's blob and writes it through `ctx.fs.writeText` with `{ kind: 'replaceIfVersion', version }` (`packages/fs/fs/src/types.ts:123-125`), so it flows through sandbox, approval, and observation like any write, refuses with `FS_STALE_VERSION` when the file moved since the stop was taken, logs normally, and the next scan appends a fresh row — "revert the revert" stays possible and model-visible ⟺ logged holds because the restore is itself a logged tool call.

```ts
// packages/checkpoint/tool-checkpoint/src/restore.ts
const text = await checkpoints.content(path, turn)              // blob fetch; never walks
await ctx.fs.writeText(target, text, { kind: 'replaceIfVersion', version: obs.version }, signal, sandbox)
```

Deleted files restore the same way (blob survives); created-files roll back to a delete through a seam addition (`FileSystem` today has no remove; the missing op is added in the same change, behind the same sandbox gauntlet).

### The critique loop

The universal reason line is owned by the [registry-injected `_dsh_harness_purpose` decision](../architecture/2026-10-07-registry-injected-purpose-field.md): the registry injects a required harness-meta key into every exposed tool schema, splits it at ingress onto a `tool/call.purpose` sibling field, and strips it from the body's arguments, so every card — including third-party mutators this repo has never seen — carries a displayable, rebuttable line. Declared intent fields (`bash`/`pwsh`/delegation `description`, escalation `justification`) and adjacent assistant text remain the fallback precedence for legacy clients, never a refusal. `checkpoint/scan` rows cite the same purpose string, so the displayed line and the critique target are one string. Critiques are `checkpoint/comment` events anchored `(turn, callId, path, rowDigest, hunkIndex)` — hunk line ranges resolve deterministically because `structuredPatch(before, after)` is pure over immutable row content, so anchors never drift by construction. Collection is one command (wired like `dsh-command-feedback`'s `/feedback`, `packages/feedback/command-feedback`) that folds unresolved threads plus capped cited hunks into a single user message through the existing input/submit path (`claim.submit`, `packages/client/ui-conversation/src/client/input/facade.ts`); being a user turn it is logged by construction and its fixing turn snapshots like any other. An optional read-only `snapshot_read(path, turn)` tool gives the model locators instead of inlining 40 kB of hunks.

### Presentation

Turn zoom is the log's own identity stack — session → turns (`turn/start|end`) → calls (`callId`, `{turn, step}`) → rows → hunks — and the zoom surface is the existing trajectory table (`packages/client/ui-trajectory`): a turn card expands into per-call cards carrying the stamped reason, the diff (`DiffResultView`), a restore button, and the rebut affordance writing the anchor. The per-file slider is a new client package (`client/ui-file-history`, locale-owned copy per the [locale-owned UI copy decision](../../implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)): stops come from `stops(path)` with stored `added/removed` badges, the selected stop renders a frozen read-only CodeMirror 6 view (`ui-editor` already runs CM6, `packages/client/ui-editor/package.json:49-72`) whose doc is the row's after-text, side-by-side against the previous stop via `@codemirror/merge`'s `MergeView`.

```ts
// packages/client/ui-file-history/src/client/thread-gutter.ts — CodeMirror 6 extension sketch
const threadDecorations = StateField.define<DecorationSet>({
  create: state => build(state),
  update(set, tr) { return set.map(tr.changes) },
  provide: f => EditorView.decorations.from(f),
})
function build(state: EditorState): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  for (const stop of currentStops(state)) {
    for (const hunk of cachedHunks(stop)) {                    // deterministic line ranges
      b.add(docLine(hunk.newStart).from, docLine(hunk.newStart).from,
        Decoration.line({ class: 'cm-checkpoint-changed' }))
      b.add(docLine(hunk.newStart).from, docLine(hunk.newStart).from,
        Decoration.widget({ widget: new ThreadWidget(stop, hunk), block: true, side: 1 }))
    }
  }
  return b.finish()
}
```

`ThreadWidget.toDOM` mounts the React thread card (comment composer, AI-reply request, resolve, restore) inside the frozen doc; `destroy()` tears the root down, satisfying the HMR-disposal requirement. The **live** editor gets gutter dots only ("threads exist on this file's lineage"); clicking drops into the frozen view, because turn-N hunk coordinates in a turn-M live doc are stale by definition. V2 may remap best-effort with `diffLines(row.after, liveDoc)` → `ChangeSet` → `range.map(change)` (`@codemirror/state` position mapping), orphan-badged when unmappable; it does not ship in v1. Freeze semantics follow VS Code: the comparison sides are the selected stop and its predecessor, never rebased under the moving live doc.

### Assembly order

PR1 capture core (`checkpoint` seam + `checkpoint-local` + `checkpoint-bracket`, `tools/execute` / `fs/observed` payload widening, remove-op on `FileSystem`, registry-injected `purpose` per the [architecture note](../architecture/2026-10-07-registry-injected-purpose-field.md), REAL-composition test). PR2 events + projection (`checkpoint/scan`, catalog regeneration, `file-timeline` projection, BFF remotes). PR3 restore tool + trajectory zoom UI. PR4 `checkpoint-git` provider behind config. PR5 `client/ui-file-history` slider, CodeMirror frozen surface, threads, collect command. Each PR carries the repository's process weight: 100% per-package coverage, locale dictionaries, HMR hygiene, package READMEs with the canonical Model Experience block, and this note updated as facts land.

## Alternatives considered

- **VS Code local history** (per-file full copies at save, 50-entry/256 KB caps) — right storage discipline, wrong capture surface: editor-save hooks never see the agent's terminal, which is the entire problem.

## Acceptance criteria

A session in which `write`, `str_replace_editor`, and `bash` (including a `sed -i` and a `rm`) mutate workspace files shows, without restart: every effect as a row on `turn/end`-bounded stops; a file slider whose non-adjacent-stop diff equals `computeHunkDiffs` over the stored digests; gap markers where a write deliberately bypasses capture (test injects an out-of-band write between reconciliations); restore that refuses with `FS_STALE_VERSION` after an intervening change and appends rather than truncates; a critique loop whose collect message reproduces the cited hunks verbatim with `truncated`/`total` on oversize; `interval: 'event'` catching an mtime-preserving rewrite that `interval: 'call'` misses; an old reader refusing the new log only when events lack their recorded envelope per the version mechanism; and `pnpm run test:coverage` green on every new package.

## Risks

Exclusion misconfiguration is the first real failure mode — an unpruned `node_modules` reintroduces the measured 6.4 s walk per snapshot, so the default excludes ship validated and the walk regression is a gate fixture. The `.gitignore` dilemma is accepted, not solved: honoring ignores leaves ignored build outputs unrevertible, overriding them risks `private` files entering the store; the mitigation is explicit scope config plus the documented limitation, and a security review of the store's permissions (`0700`) and retention scrubbing of removed rows. Escaped background daemons and off-root writes remain invisible at every interval; the gap marker surfaces the observation failure instead of hiding it, and the limit is user-facing documentation. Inotify watch limits and FSEvents coarseness bound `event` mode; the reconciliation sweep is the floor and its cadence is config. Retention/GC correctness (orphan blob pruning against live rows, restore references included) needs a dedicated property test before the store ships enabled by default, because the failure mode is a silently unrevertable old stop. The ecosystem plugins prove demand and the shadow pattern's viability but are unmaintained single-maintainer v0.1.0 packages; none is adopted — their existence is evidence, their code is not a dependency.
