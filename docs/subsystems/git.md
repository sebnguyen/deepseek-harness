# Read-only git

The git seam — a [capability seam](../glossary.md#capability-seam) exposing read-only repository facts — the worktree status relative to HEAD and single-file diffs — on one `ctx.git` service, split across packages: Service Definition ([dsh-git](../../packages/git/git), `ctx.git` + the provider registry) and Service Provider ([dsh-git-isomorphic](../../packages/git/git-isomorphic), isomorphic-git over the composed `ctx.fs`). The seam's current Consumer is the [workspace files remote](sidebar-right.md) (`scmStatus`), which feeds the web explorer's change badges. Because the provider reads through the composed filesystem, a remote or sandboxed execution world serves git facts the same way a local one does, and a world whose backend cannot reach the repository's `.git` answers no status. Session-scoped change records remain the [checkpoint](filesystem.md) vocabulary; this page owns the git-relative one.

Source: [`packages/git/git/src/types.ts`](../../packages/git/git/src/types.ts)

## Vocabulary

`GitFileStatus` is a closed five-state vocabulary; `GitStatusEntry` pairs it with a repository-relative path, and `GitStatusResult` adds the resolved HEAD oid (null under an unborn HEAD) and a truncation flag the seam sets when it cuts a provider result to the configured `maxEntries`. `GitFileDiff` carries one file's HEAD and worktree texts, each null when absent on that side and each cut to the request's (or configured) `maxFileBytes`.

```ts type-equiv
/**
 * One file's state relative to the repository HEAD, as a closed vocabulary:
 * `modified` covers staged and unstaged content change, `added` covers staged
 * new files and every file under an unborn HEAD, `deleted` covers removals,
 * `untracked` covers files the index does not know, and `other` covers
 * renames, copies, and type changes a row-level status cannot name.
 */
type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'other'
```

```ts type-equiv
/** One file's path and its status relative to HEAD. */
interface GitStatusEntry {
  /** Repository-relative path, slash-separated. */
  readonly path: string
  readonly status: GitFileStatus
}
```

```ts type-equiv
/** The complete status of one repository at one read. */
interface GitStatusResult {
  /** The resolved HEAD object id, or null when the repository has no commit yet. */
  readonly head: string | null
  readonly entries: readonly GitStatusEntry[]
  /** Whether the provider's entry cap dropped further changed files. */
  readonly truncated: boolean
}
```

```ts type-equiv
/** One file's texts relative to HEAD; null marks absence on that side. */
interface GitFileDiff {
  /** Repository-relative path, slash-separated. */
  readonly path: string
  /** The file's text at HEAD, or null when HEAD does not carry it. */
  readonly oldText: string | null
  /** The file's current worktree text, or null when the file is gone. */
  readonly newText: string | null
}
```

## Provider contract and selection

A provider owns a stable `id` and implements `available()`, `status()`, and `diff()`; `registerProvider` rejects duplicate ids and its disposer, like fiber disposal, unregisters. Selection mirrors the web seam: a configured id must be registered and available, without one exactly one usable provider auto-selects, and the seam reports `GIT_PROVIDER_CONFIGURED_MISSING`, `GIT_PROVIDER_CONFIGURED_UNAVAILABLE`, `GIT_PROVIDER_AMBIGUOUS`, or `GIT_PROVIDER_UNAVAILABLE` otherwise. Execution caps live on the seam: `maxEntries` and `maxFileBytes`; a request may narrow, never widen.

`GitError` extends `HarnessError` with stable codes: `GIT_NOT_REPOSITORY` names a workspace root with no `.git`; `GIT_NOT_FOUND` names a path absent from both HEAD and the worktree; `GIT_NOT_TEXT` names a binary file a diff refused; `GIT_TOO_LARGE` names a file over the effective byte cap.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgit--gitruntime"></a>

### `ctx.git` — `GitRuntime`

The git capability service. Registered as `ctx.git` (one instance per context).

Selection semantics (resolved at execution time, never order-dependent):

- A configured id that is registered and `available()` → that provider.
- A configured id not registered → `GIT_PROVIDER_CONFIGURED_MISSING`.
- A configured id registered but unavailable → `GIT_PROVIDER_CONFIGURED_UNAVAILABLE`.
- No id configured, exactly one registered usable provider → that provider.
- No id configured, multiple usable providers → `GIT_PROVIDER_AMBIGUOUS`.
- No id configured, no usable provider → `GIT_PROVIDER_UNAVAILABLE`.

```ts cordis-catalog
/**
 * Register a provider. Throws {@link GitError} `GIT_DUPLICATE_PROVIDER` if its
 * id is already registered. Returns a disposer; disposed with the calling
 * fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: GitProvider): () => void

/**
 * Read one repository's status through the selected provider. A result
 * above the request's (or configured) entry cap is truncated and flagged.
 * @param request - the repository root and optional entry cap.
 * @param signal - optional cancellation forwarded to the provider.
 * @returns the status, cut to the effective entry cap.
 */
async status(request: GitStatusRequest, signal?: AbortSignal): Promise<GitStatusResult>

/**
 * Read one file's HEAD and worktree texts through the selected provider.
 * @param request - the repository root, file path, and optional byte cap.
 * @param signal - optional cancellation forwarded to the provider.
 * @returns the two texts, each within the effective byte cap.
 */
async diff(request: GitDiffRequest, signal?: AbortSignal): Promise<GitFileDiff>
```

Source: [`packages/git/git/src/index.ts`](../../packages/git/git/src/index.ts)
<!-- END GENERATED cordis-surface -->
