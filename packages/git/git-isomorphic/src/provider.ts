/**
 * The read-only git provider: isomorphic-git's statusMatrix and readBlob run
 * over the {@link FsAdapter}, so reads follow the composed filesystem instead
 * of the Host's own disk. Status rows map onto the seam's five-state
 * vocabulary; the matrix is already alphabetical, so entries keep it.
 */

import type { Context } from '@deepseek-ai/cordis'
import git from 'isomorphic-git'
import type {
  GitDiffRequest,
  GitFileDiff,
  GitFileStatus,
  GitStatusEntry,
  GitStatusRequest,
  GitStatusResult,
} from '@deepseek-ai/dsh-git'
import { GitError } from '@deepseek-ai/dsh-git'
import { FsAdapter } from './adapter.ts'

/** The statusMatrix column holding the repository-relative path. */
const FILE = 0

/** isomorphic-git refusal carrying a stable error class name. */
function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'NotFoundError'
}

/** Decode bytes as UTF-8 text; NUL bytes mark binary content. */
function textOf(bytes: Uint8Array, path: string): string {
  const text = Buffer.from(bytes).toString('utf8')
  if (text.includes('\u0000')) {
    throw new GitError(`"${path}" is binary; the git seam serves text diffs only`, 'GIT_NOT_TEXT')
  }
  return text
}

/** One status row's status relative to HEAD, or undefined when the file matches HEAD exactly. */
function statusOf(row: readonly [string, number, number, number]): GitFileStatus | undefined {
  const [, head, workdir, stage] = row
  if (head === 1 && workdir === 1 && stage === 1) return undefined
  if (head === 0 && stage === 0) return 'untracked'
  if (head === 0) return 'added'
  if (workdir === 0) return 'deleted'
  if (workdir === 2 || stage === 2 || stage === 3) return 'modified'
  return 'other'
}

/** Read-only git provider over the composed filesystem. */
export class IsomorphicGitProvider {
  /**
   * @param ctx - Host context carrying the composed filesystem.
   * @param id - registry key for this provider.
   * @param maxFileBytes - inclusive byte cap on one internal read and one diff side when a request names none.
   */
  constructor(
    private readonly ctx: Context,
    readonly id: string,
    private readonly maxFileBytes: number,
  ) {}

  /** True while the composed filesystem this provider reads is mounted. */
  available(): boolean {
    return this.ctx.get('fs') !== undefined
  }

  /**
   * Whether `dir/.git/HEAD` reads as a file: repositories resolve even
   * unborn; anything else is not a repository.
   * @param dir - the candidate repository root.
   * @returns true when the directory carries a git HEAD file.
   */
  private async repoAlive(dir: string): Promise<boolean> {
    try {
      const target = await this.ctx.fs.resolve(joinPath(dir, '.git/HEAD'))
      return (await this.ctx.fs.stat(target))?.type === 'file'
    } catch {
      return false
    }
  }

  /**
   * Read one repository's status relative to HEAD through isomorphic-git's
   * statusMatrix.
   * @param request - the repository root worked against the composed filesystem.
   * @param signal - accepted for interface parity; isomorphic-git reads are not cancellable mid-walk.
   * @returns the changed entries in matrix order with the resolved head oid, null under an unborn HEAD.
   */
  async status(request: GitStatusRequest, signal?: AbortSignal): Promise<GitStatusResult> {
    void signal
    // The walk reads and hashes changed worktree files; isomorphic-git gives
    // no capped read that survives it, so the byte cap binds diff alone.
    const fs = new FsAdapter(this.ctx)
    const head = await git.resolveRef({ fs, dir: request.workspaceRoot, ref: 'HEAD' })
      .then(oid => oid as string | null)
      .catch(async (error: unknown) => {
        if (isNotFound(error)) {
          // A resolvable HEAD file with no commit yet is a live unborn
          // repository, not the absence of one.
          if (await this.repoAlive(request.workspaceRoot)) return null
          throw new GitError(`"${request.workspaceRoot}" is not a git repository`, 'GIT_NOT_REPOSITORY', { cause: error })
        }
        throw error
      })
    let matrix: [string, number, number, number][]
    try {
      matrix = await git.statusMatrix({ fs, dir: request.workspaceRoot })
    } catch (error: unknown) {
      if (isNotFound(error)) {
        throw new GitError(`"${request.workspaceRoot}" is not a git repository`, 'GIT_NOT_REPOSITORY', { cause: error })
      }
      /* v8 ignore next 2 -- isomorphic-git wraps non-absent walk faults in its own InternalError, untestable through the provider */
      throw error
    }
    const entries: GitStatusEntry[] = []
    for (const row of matrix) {
      const status = statusOf(row)
      if (status !== undefined) entries.push({ path: row[FILE], status })
    }
    return { head, entries, truncated: false }
  }

  /**
   * Read one file's HEAD and worktree texts, each within the request's byte
   * cap; absent sides are null and two absent sides fail `GIT_NOT_FOUND`.
   * @param request - the repository root and repository-relative file path.
   * @param signal - accepted for interface parity.
   * @returns the two texts.
   */
  async diff(request: GitDiffRequest, signal?: AbortSignal): Promise<GitFileDiff> {
    void signal
    // Each side is capped after its read; repository internals were read
    // uncapped by the adapter above.
    const cap = request.maxFileBytes ?? this.maxFileBytes
    const fs = new FsAdapter(this.ctx)
    // An unborn repository reads no HEAD side; a missing one refuses.
    const head: string | null = await git.resolveRef({ fs, dir: request.workspaceRoot, ref: 'HEAD' })
      .catch(async (error: unknown) => {
        if (isNotFound(error)) {
          if (await this.repoAlive(request.workspaceRoot)) return null
          throw new GitError(`"${request.workspaceRoot}" is not a git repository`, 'GIT_NOT_REPOSITORY', { cause: error })
        }
        throw error
      })
    const oldText = head === null ? null : await git.readBlob({ fs, dir: request.workspaceRoot, oid: head, filepath: request.path })
      .then((result) => {
        if (result.blob.byteLength > cap) {
          throw new GitError(`HEAD "${request.path}" exceeds the ${cap} byte cap`, 'GIT_TOO_LARGE')
        }
        return textOf(result.blob, request.path)
      })
      .catch((error: unknown) => {
        /* v8 ignore next 3 -- wrapped reads report only absence-marked refusals or folded faults, so nothing else reaches this arm */
        if (isNotFound(error)) return null
        throw error
      })
    const newText = await fs.readBytes(joinPath(request.workspaceRoot, request.path))
      .then(bytes => (bytes.byteLength > cap
        ? (() => { throw new GitError(`"${request.path}" exceeds the ${cap} byte cap`, 'GIT_TOO_LARGE') })()
        : textOf(bytes, request.path)))
      .catch((error: unknown) => {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
        if (code === 'ENOENT' || code === 'FS_NOT_REGULAR_FILE' || code === 'FS_NOT_FOUND') return null
        /* v8 ignore next 2 -- the adapter translates absence or passes the backend fault through; the walk tests pin that on the adapter */
        throw error
      })
    if (oldText === null && newText === null) {
      throw new GitError(`"${request.path}" is in neither HEAD nor the worktree`, 'GIT_NOT_FOUND')
    }
    return { path: request.path, oldText, newText }
  }
}

/** Join a repository-relative path onto its root with `/` regardless of platform. */
function joinPath(root: string, relative: string): string {
  return `${root.replace(/[/\\]+$/, '')}/${relative}`
}
