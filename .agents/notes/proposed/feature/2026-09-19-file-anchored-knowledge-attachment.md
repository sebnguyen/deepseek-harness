# Agent Note: File-anchored durable knowledge attachment

Status: proposed

## Problem

An agent re-derives the same file-level context in every session. Nothing records, for a given source file, the non-obvious facts a reader needs before changing it: which caller depends on a nullable return, why the retry budget includes the first attempt, why the lock is taken in that order. That context is either lost when the session ends or restated in a prompt section, where it costs tokens on every request and drifts from the code without any signal.

What is missing is a durable note attached to one file, delivered when the agent reads that file, and marked when the file changes underneath it.

## Proposal

A **note** is one small JSON record attached to one source file. It states one thing worth knowing before changing that file, plus the hash of the target content it was last checked against — a hash the harness computes, so an author never sees one. Two dedicated tools are the entire authoring surface: `read_note { target }` fetches the note for a source file, and `upsert_note { target, claim }` writes it, where an empty `claim` deletes the note. A note reaches the model as a single pointer line whenever a noted file is read; the pointer names the file, and `read_note` fetches the body. Notes live under the harness home and never in the repository, so they never enter `git status`.

Nothing about the store is committed, reviewed, or versioned. The one question it must answer is whether a note still matches the file it describes.

### The record

One note per source file, keyed by the file's absolute path. A note is small enough to read and edit directly:

```json
{
  "target": "/home/me/repo/packages/http/client.ts",
  "claim": "The retry budget includes the first attempt, so raising maxRetries changes caller-visible behavior.",
  "affirmedAgainst": "sha256:1f3a...",
  "hashScheme": "source-norm@1",
  "author": "agent"
}
```

`claim` and `target` are the only fields a writer supplies. `upsert_note` stamps `affirmedAgainst` with the normalized hash of the target at write time and records `author`. An empty `claim` deletes the record, so one tool creates, updates, and retracts. The storage path is derived from `target` and is never shown to the model: the tools take the source-file path the model already has.

There is deliberately no version history. The text of a note is already in the session log as the tool result that delivered it, so replay needs no store lookup, and an unreviewed local store has no audit to serve. `affirmedAgainst` is the only durability the design needs.

### Delivery

Reading a file that has a note attaches exactly one pointer line to the read result, one per state, pinned verbatim:

```text
Note for packages/http/client.ts (current): ~/.dsh/knowledge/notes/home/me/repo/packages/http/client.ts.json
Note for packages/http/client.ts is stale — the file changed since this note was written. Read it with read_note before relying on it.
Note for packages/http/client.ts is orphaned — the file it describes is gone. Read it with read_note before relying on it.
```

The three strings are pinned because each must stand alone: it names the file it describes and tells the model how to fetch the note, stripped of any row chrome around it. All three states emit. An orphaned note is the one state the model cannot check against its source, so staying silent there would drop the note exactly where old context is most dangerous — including the case where a new file appears at a formerly noted path.

The pointer observes the `read` tool through `tools/post-execute` and folds a `UserMessage` into the decision's `additionalContexts`. The package owning `read` therefore acquires no dependency on this one, and no new session event type is required: injected context projects in user role under the loop's ordinary derivation, so the pointer is logged and reconstructed like any other message. In the Web transcript it renders as the collapsed context-injection row every plugin notice uses — header `Context injection`, producer label `knowledge-notes`, the bounded summary on the collapsed row, the full text behind the disclosure — never as a user message, because the chat projection routes every non-user message source to the context row. No client renderer or locale entry is added.

The pointer fires for `read` of a noted file only. A `grep` or `glob` result naming a noted file attaches none: those tools fire constantly and name many files, so per-file pointers would flood the injection row, and the ordinary read that follows still fires.

`read_note` and `upsert_note` are ordinary tool Consumers registered by this package, with presenter cards derived from their logged results. No note path is ever in a tool argument, so the model never learns where the store lives — the tools take the `target` it already has.

### Freshness and affirmation

A note is **live** when its target exists and the normalized hash matches `affirmedAgainst`, **stale** when the target exists and the hash differs, and **orphaned** when the target no longer exists. The states stay distinct: collapsing stale into orphaned would discard a note on the first rename, and an orphaned note keeps its claim until it is re-pointed or deleted.

The hash normalizes line endings, trailing whitespace, and blank-line runs. That covers the two ways a file changes without changing meaning — a formatter run and an editor round-trip — and nothing more. Normalizing identifiers or declaration order is out of scope, because an identifier is semantic content and suppressing it would hide changes that matter. `hashScheme` names the normalization so a later change to it is a migration rather than a silent invalidation of every note.

Writing a note is affirming it. `upsert_note` stamps `affirmedAgainst` with the target's current hash at write time, so an author asserts a claim against the code as it stands without computing anything. The store writes through `ctx.fs` unconditionally and is the only writer of note files, so no note file is ever observed by the write tool's version policy and no observed version ever moves behind the agent's back.

A turn that changed a file which has a note opens a refresh obligation. One `agent/turn-stopping` notice surfaces the affected notes per turn, and the honest responses are to re-affirm with `upsert_note`, to update the claim, or to leave it stale — which the next read pointer reports.

### Turn-boundary coordination

`agent/turn-stopping` is currently unconsumed, and another proposed policy, `2026-09-19-declared-verification-claims.md`, also consumes it to run verifiers and steer bounded repair steps. Both listeners steer the same turn open, and the interaction is not benign: a reconciliation step is a model round-trip that re-enters the turn boundary and can consume the verifier's repair budget. Listener order is not the control, because the loop awaits every listener and then re-reads its inbox, so the outcome follows the state the listeners leave rather than which one ran first.

This proposal therefore adopts a data rule rather than an ordering contract: it steers at most once per turn, marks its steer as a reconciliation step, and declines when the session has an open verification claim. The alternative, shared steer accounting between the two plugins, is recorded under Alternatives considered.

### Trust

The store is local, unreviewed, and writable by the agent, and the pointer is attached automatically. A note is therefore a channel through which one session shapes the context of later sessions on the same machine. The stakes are lower than a committed store's, because there is no other user to mislead, but the channel is real: the pointer labels a note the agent wrote, and a claim is data that never overrides the task.

### Implementation sketch

Two phases. The fences are `ignore-check` sketches that fix the contracts; their compiled forms land with the package.

| Phase | Lands | Proves before merge |
|---|---|---|
| 1 | The store, the note format, the normalized hash, the two tools, and the pointer listener | A pointer appears for a noted file and not for an unnoted one; a formatter run leaves the note live; an absent target reports orphaned; an empty claim deletes |
| 2 | The turn-boundary notice and a keyless snapshot | At most one notice per turn; the replayed request equals the live one |

#### The plugin

One function plugin, `packages/knowledge/knowledge-notes` (`@deepseek-ai/dsh-knowledge-notes`), named-exporting `name` / `inject` / `Config` / `apply` and no default export. It is the entire component: it owns the store, registers the two tools, and registers two listeners. No other package changes, because it reaches `read` through the documented `tools/post-execute` extension point instead of importing the package that owns `read`.

```ts ignore-check
export const name = 'knowledge-notes'
/** `fs` reads and writes the store; `tools` registers the note tools; `systemPrompt` states the one-note-per-file rule. */
export const inject = ['fs', 'tools', 'systemPrompt']

export interface Config {
  /** Harness-home override; the store lives under `<home>/knowledge/notes`. */
  dshHome?: string
}
export const Config: z<Config> = z.object({ dshHome: z.string().optional() })

export function apply(ctx: Context, config: Config): void {
  const store = createNoteStore(ctx, join(resolveDshHome(config.dshHome), 'knowledge', 'notes'))
  ctx.effect(() => registerNoteTools(ctx, store), 'knowledge-notes tools')
  ctx.on('tools/post-execute', attachPointer(ctx, store))
  ctx.on('agent/turn-stopping', noticeRefreshObligation(ctx, store))
  ctx.systemPrompt.section({ name: 'knowledge-notes', order: NOTE_SECTION_ORDER, text: ONE_NOTE_PER_FILE })
}
```

`tools` is injected to register the two Consumers through the documented tool registration; the pointer listener itself needs no tool handle, which is how `repeat-tool-reminder` observes the same event without one. `hashScheme` stays a fixed constant rather than a `Config` field, because changing it migrates every stored hash rather than varying by deployment. The prompt section is one sentence — the tools carry the rest of the contract in their schemas.

#### Where a note lives

A note is one JSON file at `<home>/knowledge/notes/<absolute-target-path>.json`, the leading separator dropped so the absolute path nests beneath the store directory: `/home/me/repo/a.ts` becomes `<home>/knowledge/notes/home/me/repo/a.ts.json`. This is now a private store detail. The model never computes it, never reads it, and never writes it — the tools accept `target` and translate. The path stays derivable from the record's own `target`, which keeps the store legible to whoever opens it and makes a record's location checkable against its content.

A `storageDomain` remains rejected on a specific mechanism: a stored per-record document is a `{ version, record }` envelope, and `parseRecord` treats a document that fails to parse or carries an unaccepted version as absent. A hand-edited note would read back as no note and be silently discarded rather than rejected — exactly the knowledge this feature exists to keep. The store is plain JSON files.

Note I/O goes through the `fs` capability — `resolve`, `stat`, `readText`, `writeText` — not `node:fs`. `stat` returning `undefined` is the orphaned signal. The store omits the write intent, which `writeText` documents as unconditional create-or-overwrite; the guarding variants are wrong here, because note files are never observed through a tool. Reading validates the record against its schema and checks that `target` matches the path it was found at; a malformed or mislocated note reads as no note and is never deleted. `forTarget` returns no note for a path under the store root, so a note cannot describe another note and chain a pointer onto its own read.

One file reachable by two paths — a symlink and its referent — has one `targetKey` but two `displayPath`s, so it can carry two notes. Keying by `targetKey` would collapse them, but then a note's `target` stops being the absolute path the model already holds from a read result. The store keys by `displayPath` and accepts the duplicate.

#### Which session events this emits

None are added. Every model-visible input was already event-shaped by the loop, and this plugin produces each through a mechanism the log already records. The one member either injection touches is the existing `SessionEventMap['agent/inbox/spliced']` — one normalized mutation of an agent's durable pending-message lists, payload `{ target, start, removedCount?, inserted, outcome? }` — and `inserted: UserMessage[]` carries the pointer or notice verbatim, with its text, its `source`, and its position.

- **The pointer** is a `UserMessage` in `PostToolDecision.additionalContexts`. `executeToolCalls` passes each entry to `acceptContext`, which calls `inbox.splice('next-step', …)`, and `splice` appends `agent/inbox/spliced` with the pointer in `inserted`.
- **The turn-boundary notice** is `agent.steer(message)`, which is `inbox.splice('next-turn', Infinity, …)` — the same event with the same payload.
- **The tools** add nothing: their effects are ordinary `tool/call` and `tool/result` records.

Because the injections ride an existing `SessionEventMap` member, this proposal adds no event type and does not move `SESSION_FORMAT_VERSION`; replay reconstructs the pointer and the notice from `agent/inbox/spliced` alone. The store is not session state and is never replayed: the model-visible ⟺ logged rule is satisfied by the pointer text that was injected and the tool results that were returned, not by the store behind them, so replay never reads a note file.

#### The hash, the pointer, and the notice

The normalized hash is the only content contract, and it is shared by staleness detection and affirmation:

```ts ignore-check
/**
 * The normalized form a note hashes. It absorbs the two ways a file changes without
 * changing meaning — a formatter run and an editor round-trip — and nothing else,
 * because an identifier is semantic content.
 * @param text - the target file's decoded contents.
 * @returns the normalized text whose hash is stored as `affirmedAgainst`.
 */
function normalizeSource(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')       // line endings
    .replace(/[ \t]+$/gmu, '')      // trailing space on any line
    .replace(/\n{3,}/gu, '\n\n')    // runs of blank lines
}

function sourceHash(text: string): string {
  return `sha256:${createHash('sha256').update(normalizeSource(text), 'utf8').digest('hex')}`
}
```

The pointer is an observe-and-enrich listener, never a veto, and it delegates first because `tools/post-execute` is a waterfall. `renderPointer` returns exactly one of the three strings pinned under Delivery, selected by the note's state:

```ts ignore-check
/** Load-bearing label: an unlabeled context renders as an ordinary user prompt in derived history. */
const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'knowledge-notes' }

/** Observe-and-enrich, never veto: delegate first, then fold the pointer onto whatever came back. */
const attachPointer = (ctx: Context, store: NoteStore) =>
  async (exec: ToolExecution, _result: ToolResult, next: () => Promise<PostToolDecision>): Promise<PostToolDecision> => {
    const downstream = await next()
    if (exec.name !== 'read' || exec.agent === undefined) return downstream
    const target = await ctx.fs.resolve(exec.arguments.file_path, { cwd: exec.agent.session.header.cwd, signal: exec.signal })
    const note = await store.forTarget(target)
    if (note === undefined) return downstream
    const pointer = createUserMessage({
      content: [{ type: 'text', text: renderPointer(note, await store.freshness(target)) }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: boundContextSummary(`file note: ${note.target}`) },
    })
    // additionalContexts rides both decision variants, so a blocked call still gets the pointer.
    if (downstream.kind === 'block') {
      return { kind: 'block', feedback: downstream.feedback, additionalContexts: prependContext(pointer, downstream.additionalContexts) }
    }
    return { ...downstream, additionalContexts: prependContext(pointer, downstream.additionalContexts) }
  }
```

`exec.agent` is absent for a direct `ctx.tools.execute()` caller, which has no session to key a note against and no model to show a pointer to. Freshness re-reads the whole target rather than trusting the read window, because a partial window cannot produce a whole-file hash.

The two tools are the whole authoring surface; the hash is stamped inside the write, not derived from a borrowed tool:

```ts ignore-check
/** One tool creates, updates, and deletes: claim in, hash stamped; an empty claim removes the record. */
const upsertNote = (ctx: Context, store: NoteStore) =>
  async (args: { target: string; claim: string }, exec: ToolExecution): Promise<UpsertOutcome> => {
    const resolved = await ctx.fs.resolve(args.target, { cwd: exec.agent?.session.header.cwd, signal: exec.signal })
    if (args.claim === '') {
      await store.remove(resolved.displayPath)
      return { deleted: true }
    }
    await store.put({
      target: resolved.displayPath,
      claim: args.claim,
      affirmedAgainst: sourceHash(await ctx.fs.readText(resolved, exec.signal)),
      hashScheme: HASH_SCHEME,
      author: 'agent',
    })
    return { state: await store.freshness(resolved) }
  }
```

`upsert_note` validates at the tool-JSON boundary — the schema requires a non-empty-string-or-empty `claim`, so the delete overload is explicit rather than guessed.

The turn-boundary notice is the one listener on a serial dispatch, so it neither delegates nor is delegated to. It announces the obligation and never edits a note: re-affirming, restating, and leaving the note stale are all honest responses it leaves to the agent. Both of its inputs are derived from the session log, never stored in plugin-private state: the touched set is a projection over this turn's `tool/call` records — write tools already log their arguments — intersected with noted targets, and the dedupe asks the log whether a splice carrying this plugin's source was already appended for the turn. The steer logs itself, so the notice's own event is its dedupe record; a plugin reload or a session resume can neither lose nor double-count an obligation, and the WeakMap disposal ceremony other per-session observers need never exists here.

```ts ignore-check
/** At most one notice per turn; touched set and dedupe are both read from the session log, never stored. */
const noticeRefreshObligation = (ctx: Context, store: NoteStore) =>
  async ({ agent, turn }: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> => {
    if (hasSteeredThisTurn(agent.session, turn)) return
    const affected = await store.notedTargetsTouched(agent.session, turn)
    if (affected.length === 0) return
    agent.steer(createUserMessage({
      content: [{ type: 'text', text: renderObligation(affected) }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: boundContextSummary(`notes to re-check: ${affected.length}`) },
    }))
  }
```

The remaining scope decisions are settled: the pointer is scoped to `read` of a noted file, and there is no garbage collection — the store grows monotonically, deletion is only what an agent asks `upsert_note` to do, and a collection pass can arrive later without changing any record.

## Alternatives considered

**Anchor a note to a code region rather than a file.** Region anchoring is more precise: a note about one function would survive an unrelated edit elsewhere in a large file, and a file could carry several notes with independent claims. It lost on machinery. A region anchor needs a parser per language, symbol extraction, region normalization, a normalizer registry whose version is part of the anchor, content-hash matching to resolve a region after a rename, and — once a file can hold several notes — ranking, per-read token budgets, and suppression of notes already delivered. The file-level unit answers a different and narrower question ("what should I know before touching this file?") in exchange for deleting all of it.

**Commit the store to the repository.** A committed store is shared, reviewable, and travels with a clone, which is the version where the whole repository gets easier over time rather than one machine. It lost because it needs repository-relative keys, a review path, a commit check that rejects an unsettled note, and a trust boundary distinguishing reviewed from agent-authored text — four mechanisms that a local store does not need. The cost is recorded under Risks, and the design can graduate to it.

**Author notes with the ordinary `write` tool.** Borrowing `write` avoids two tool schemas on every request. It lost because the hash then cannot live in the note: stamping it would mean the harness rewriting the file the agent just wrote, moving the version the observation policy recorded and failing a second same-turn write, so freshness needs a sidecar record beside every note and the model must compute a mirrored storage path to author anything. Two schemas buy a single-record note, validation at the tool-JSON boundary, and a model that names only source-file paths.

**Store the backend target key rather than the absolute path.** The resolved target already carries an opaque key. It lost because that key is backend-owned and may be a revision identifier rather than a path, so a stored key is neither readable nor portable between backends, and the note should stay legible to whoever opens it.

**Keep immutable content-addressed versions.** Version history would let an old note be resolved exactly and support an audit of what was believed when. It lost because the text a model saw is already in the session log as a tool result, an unreviewed local store has no audit consumer, and the only question left — does the note still match the file — is answered by one stamped hash.

**Attach the note body to every read instead of a pointer.** Attaching the body would save the model a second call and guarantee it sees the claim. It lost because a read would then carry unbounded prose whether or not the fact was needed, and a request prefix would change on every noted read rather than on the rare stale one.

**Store notes as source comments.** Co-location carries a note across a rename for free and keeps it beside the code. It lost because comments cannot express a fact relating two files, they put durable prose into every diff, and they would require a parser to read back reliably.

**Retrieve notes with embeddings.** Similarity search would surface related notes without an exact path match. It lost because retrieval would depend on index state rather than on the file the model is reading, and because a similarity result carries no bound on how much context a read adds.

## Acceptance criteria

- A `read` of a file with a note attaches exactly one pointer line; a `read` of a file without one attaches none.
- A pointer reports live, stale, and orphaned distinctly, and a rename that moves a target reports orphaned rather than deleting the note.
- A formatter run or an editor round-trip leaves a note live; a semantic edit marks it stale.
- `upsert_note` with a claim stores the note with `affirmedAgainst` stamped at write time; `upsert_note` with an empty claim deletes the note and leaves no record.
- No note storage path appears in any tool argument, tool result, or prompt section text.
- A turn that changes several noted files produces at most one turn-boundary notice; a turn that changes none produces none.
- The store is created under the harness home and no path under it is ever required to be inside a repository.
- A keyless recorded-session snapshot pins the pointer text, an upsert, a deletion, and equality between the replayed and live requests.
- `packages/fs/tool-fs` declares no dependency on the knowledge package.

## Risks

**Two tool schemas ride every request.** `read_note` and `upsert_note` cost tokens whether or not any note exists. This is the price of an explicit contract and was knowingly paid; a profile that does not mount the package pays nothing.

**The store is per-machine.** Two people working on one repository never see each other's notes, and a fresh clone or a new laptop starts with none, so the cumulative benefit is bounded by one machine. This is the property knowingly given up by choosing local storage, and the committed-store alternative is the path that restores it.

**Any semantic change marks the whole file's note stale.** Normalization covers formatting, but adding an import, renaming a private helper, or editing a comment all mark the note stale and surface a notice. At file granularity this is coherent — the note may well mention that name — but it fires more often than a region anchor would, and a noisy notice is one the agent learns to skim.

**One note per file collapses distinct facts into one unit.** A file with five separate gotchas gets one note rather than five, so a claim has no identity of its own, cannot be superseded independently, and cannot be linked to precisely. The note has to be written as prose that stays coherent as a whole.

**Upserting a claim silently re-affirms it against code the author did not reread.** `upsert_note` stamps the current hash, so correcting a typo binds the claim to whatever the file says now. The hazard is real for an agent that edits prose without reading the target.

**Orphaned notes accumulate.** A deleted or renamed target leaves a note that only a pointer for a recreated path surfaces. An agent can delete one with an empty claim, but nothing does so automatically; the store grows monotonically until a real consumer justifies a collection pass, which can arrive without changing any record.
