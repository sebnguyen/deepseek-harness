/**
 * The statusMatrix row vocabulary shared by both walk paths: the composed-
 * filesystem walk and the off-loop host walk map rows with one decoder, so the
 * seam's five-state vocabulary never forks by transport.
 *
 * @module @deepseek-ai/dsh-git-isomorphic/status-rows.ts
 */
import type { GitFileStatus, GitStatusEntry } from '@deepseek-ai/dsh-git'

/** The statusMatrix column holding the repository-relative path. */
export const FILE = 0

/** isomorphic-git refusal carrying a stable error class name. */
export function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'NotFoundError'
}

/** One status row's status relative to HEAD, or undefined when the file matches HEAD exactly. */
export function statusOf(row: readonly [string, number, number, number]): GitFileStatus | undefined {
  const [, head, workdir, stage] = row
  if (head === 1 && workdir === 1 && stage === 1) return undefined
  if (head === 0 && stage === 0) return 'untracked'
  if (head === 0) return 'added'
  if (workdir === 0) return 'deleted'
  if (workdir === 2 || stage === 2 || stage === 3) return 'modified'
  return 'other'
}

/** Fold matrix rows into changed entries, keeping matrix order. */
export function entriesOf(matrix: readonly (readonly [string, number, number, number])[]): GitStatusEntry[] {
  const entries: GitStatusEntry[] = []
  for (const row of matrix) {
    const status = statusOf(row)
    if (status !== undefined) entries.push({ path: row[FILE], status })
  }
  return entries
}
