/**
 * Git vocabulary for the capability seam. Requests carry the caller's
 * workspace root and optional caps; results are closed vocabularies a
 * Consumer switches on, and `GitError` codes are the only failure channel.
 * @module @deepseek-ai/dsh-git/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * Stable failure codes a caller routes on instead of parsing `message`.
 *
 * `GIT_NOT_REPOSITORY` names a workspace root with no `.git`;
 * `GIT_NOT_FOUND` names a path absent from both HEAD and the worktree;
 * `GIT_TOO_LARGE` names a file over the request's byte cap; the provider
 * codes name registry failures resolved at execution time.
 */
export type GitErrorCode =
  | 'GIT_NOT_REPOSITORY'
  | 'GIT_NOT_FOUND'
  | 'GIT_NOT_TEXT'
  | 'GIT_TOO_LARGE'
  | 'GIT_DUPLICATE_PROVIDER'
  | 'GIT_PROVIDER_CONFIGURED_MISSING'
  | 'GIT_PROVIDER_CONFIGURED_UNAVAILABLE'
  | 'GIT_PROVIDER_AMBIGUOUS'
  | 'GIT_PROVIDER_UNAVAILABLE'

/** A git seam failure carrying a stable {@link GitErrorCode}. */
export class GitError extends HarnessError {}

/**
 * One file's state relative to the repository HEAD, as a closed vocabulary:
 * `modified` covers staged and unstaged content change, `added` covers staged
 * new files and every file under an unborn HEAD, `deleted` covers removals,
 * `untracked` covers files the index does not know, and `other` covers
 * renames, copies, and type changes a row-level status cannot name.
 */
export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'other'

/** One file's path and its status relative to HEAD. */
export interface GitStatusEntry {
  /** Repository-relative path, slash-separated. */
  readonly path: string
  readonly status: GitFileStatus
}

/** The complete status of one repository at one read. */
export interface GitStatusResult {
  /** The resolved HEAD object id, or null when the repository has no commit yet. */
  readonly head: string | null
  readonly entries: readonly GitStatusEntry[]
  /** Whether the provider's entry cap dropped further changed files. */
  readonly truncated: boolean
}

/** A caller's status query; caps omitted take the seam's configured values. */
export interface GitStatusRequest {
  /** Absolute path of the repository's working directory. */
  readonly workspaceRoot: string
  /** Inclusive cap on returned entries; omitted = the seam's `maxEntries`. */
  readonly maxEntries?: number
}

/** One file's texts relative to HEAD; null marks absence on that side. */
export interface GitFileDiff {
  /** Repository-relative path, slash-separated. */
  readonly path: string
  /** The file's text at HEAD, or null when HEAD does not carry it. */
  readonly oldText: string | null
  /** The file's current worktree text, or null when the file is gone. */
  readonly newText: string | null
}

/** A caller's single-file diff query. */
export interface GitDiffRequest {
  /** Absolute path of the repository's working directory. */
  readonly workspaceRoot: string
  /** Repository-relative path of the file, slash-separated. */
  readonly path: string
  /** Inclusive byte cap on each side's text; omitted = the seam's `maxFileBytes`. */
  readonly maxFileBytes?: number
}

/**
 * A git backend registered on `ctx.git`. `available()` is sampled at execution
 * time; a read-only provider over the composed filesystem reports true while
 * its filesystem is mounted.
 */
export interface GitProvider {
  /** Stable provider identity; the registry key. */
  readonly id: string
  /** Whether the backend can serve reads right now. */
  available(): boolean
  /**
   * Read one repository's status relative to HEAD.
   * @param request - the repository root and optional entry cap.
   * @param signal - optional cancellation; the provider stops its own work when it aborts.
   * @returns the status, already cut to the request's entry cap.
   */
  status(request: GitStatusRequest, signal?: AbortSignal): Promise<GitStatusResult>
  /**
   * Read one file's HEAD and worktree texts, each cut to the request's byte cap.
   * @param request - the repository root, file path, and optional byte cap.
   * @param signal - optional cancellation; the provider stops its own work when it aborts.
   * @returns the two texts; absent sides are null.
   */
  diff(request: GitDiffRequest, signal?: AbortSignal): Promise<GitFileDiff>
}
