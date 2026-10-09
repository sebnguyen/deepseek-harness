/**
 * The raw host-disk worktree walk the worker thread runs: isomorphic-git hashes
 * every changed file in process, so the walk lives off the Host event loop. This
 * module is the self-contained closure both the worker entry and the specs load;
 * it imports no workspace package.
 *
 * @module @deepseek-ai/dsh-git-isomorphic/walk.ts
 */
import { stat } from 'node:fs/promises'
import nodeFs from 'node:fs'
import type { Stats } from 'node:fs'
import git from 'isomorphic-git'
import { isNotFound } from './status-rows.ts'

/**
 * Whether `dir/.git/HEAD` stats as a file on the Host's own disk: the walk's
 * not-repository probe, so an absent root refuses instead of faulting.
 * @param dir - candidate repository root, host path.
 * @returns true when a git HEAD file lives there.
 */
export async function hostRepoAt(dir: string): Promise<boolean> {
  try {
    return (await stat(`${dir}/.git/HEAD`)).isFile()
  }
  catch {
    return false
  }
}

/** One completed walk: changed rows and the resolved HEAD oid. */
export interface WalkReply {
  readonly kind: 'status'
  /** Resolved HEAD object id, null under an unborn HEAD. */
  readonly head: string | null
  /** statusMatrix rows: path, head, index, worktree columns. */
  readonly rows: readonly (readonly [string, number, number, number])[]
}

/** The walk's refusal: the root carries no repository. */
export interface WalkRefusal {
  readonly kind: 'not-repository'
}

/**
 * Walk one repository on the Host disk. An unresolvable HEAD over a live
 * `.git/HEAD` file is an unborn repository, not an absent one; without the file
 * the walk refuses. Other faults cross to the caller.
 * @param dir - repository root, host path.
 * @returns the changed rows and head oid, or the not-repository refusal.
 */
export async function walkRepository(dir: string): Promise<WalkReply | WalkRefusal> {
  let head: string | null
  try {
    head = await git.resolveRef({ fs: nodeFs, dir, ref: 'HEAD' })
  }
  catch (error: unknown) {
    if (!isNotFound(error)) throw error
    if (!(await hostRepoAt(dir))) return { kind: 'not-repository' }
    head = null
  }
  try {
    const rows = await git.statusMatrix({ fs: cachelessFs, dir })
    return { kind: 'status', head, rows }
  }
  catch (error: unknown) {
    // An unresolvable object under a resolvable HEAD: the object store is
    // gone or corrupt, which the seam reports like an absent repository.
    if (isNotFound(error)) return { kind: 'not-repository' }
    throw error
  }
}

const ZERO_TIME = new Date(0)

/**
 * One stat whose time fields never satisfy isomorphic-git's index stat cache:
 * real stats of a same-second, same-size rewrite would skip the re-hash and
 * report the file unchanged, so the walk always zeros the times and hashes.
 * @param read - the real host stat to sanitize.
 * @returns the same stat with its time fields zeroed.
 */
function cacheless(read: (path: string) => Promise<Stats>): (path: string) => Promise<Stats> {
  return async (path) => {
    const info = await read(path)
    return Object.assign(Object.create(Object.getPrototypeOf(info) as object) as Stats, info, {
      atime: ZERO_TIME, mtime: ZERO_TIME, ctime: ZERO_TIME,
      atimeMs: 0, mtimeMs: 0, ctimeMs: 0,
    })
  }
}

/** The host filesystem with the stat cache defeated, for the walk. */
const cachelessFs = {
  ...nodeFs,
  promises: {
    ...nodeFs.promises,
    stat: cacheless(path => nodeFs.promises.stat(path)),
    lstat: cacheless(path => nodeFs.promises.lstat(path)),
  },
}

/**
 * One walk fault as its wire message: Error text for typed faults, the
 * value's own string otherwise.
 * @param error - the thrown fault.
 * @returns the message the runner rejects with.
 */
export function faultMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
