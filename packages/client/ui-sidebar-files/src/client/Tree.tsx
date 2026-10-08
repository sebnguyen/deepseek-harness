/**
 * The shared directory tree: one level's rows, recursion for the open
 * directories, and the lines a level draws while listing, empty, cut, or
 * failed.
 *
 * The files tab and the explorer column draw the same tree; only their chrome
 * differs. What a click means is the owner's: a directory toggles, a file
 * opens, and anything else is shown but refuses to open.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  FileTypeIcon, IconFolderClose16, IconFolderOpen16, classifyFileType,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceDirectoryEntry } from '@deepseek-ai/dsh-api-workspace-files/types'
import { childPath } from './face.ts'
import type {} from './locales.ts'
import type { FilesTabState } from './store.ts'
import css from './Tree.module.css'

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Order one level's entries for display: directories first, then everything
 * else, each group by name. The endpoint's order is a listing fact; this is the
 * reader's.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
export function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group !== 0 ? group : byName.compare(left.name, right.name)
  })
}

/**
 * Say why a directory could not be listed, in terms of the directory.
 * @param t - namespace-bound translate.
 * @param failure - the settled Remote failure.
 * @returns the line to show under the directory.
 */
export function failureLine(t: TranslateNS<'sidebarFiles'>, failure: RemoteFailure): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('error.notFound')
    case 'workspace-file/not-directory': return t('error.notDirectory')
    // Carrier and unclassified host failures reach the reader as themselves:
    // this tree knows nothing useful to add to a transport-level message.
    default: return t('error.unavailable', { message: failure.message })
  }
}

/** What every level shares: the tree's state and the two gestures. */
export interface TreeContext {
  readonly state: FilesTabState
  readonly onToggle: (path: string) => void
  readonly onOpen: (path: string) => void
  readonly t: TranslateNS<'sidebarFiles'>
  /** Absolute path the reveal gesture currently highlights; absent elsewhere. */
  readonly highlighted?: string | undefined
}

/** One entry's row, and its children when it is an expanded directory. */
export function Entry({ parent, entry, tree }: { parent: string; entry: WorkspaceDirectoryEntry; tree: TreeContext }): ReactNode {
  const path = childPath(parent, entry.name)
  if (entry.type === 'directory') {
    const expanded = tree.state.expanded.includes(path)
    return (
      <li className={css.item} data-files-entry="directory" data-files-path={path}>
        <button type="button" className={css.row} aria-expanded={expanded} onClick={() => { tree.onToggle(path) }}>
          {expanded ? <IconFolderOpen16 className={css.icon} /> : <IconFolderClose16 className={css.icon} />}
          <span className={css.name}>{entry.name}</span>
        </button>
        {expanded && <ul className={css.level}><Level path={path} tree={tree} /></ul>}
      </li>
    )
  }
  if (entry.type === 'file') {
    const highlighted = tree.highlighted === path
    return (
      <li className={css.item} data-files-entry="file" data-files-path={path}>
        <button
          type="button"
          className={clsx(css.row, highlighted && css.highlighted)}
          data-files-highlighted={highlighted || undefined}
          ref={highlighted
            ? (node) => {
              if (typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
            }
            : undefined}
          onClick={() => { tree.onOpen(path) }}
        >
          <FileTypeIcon kind={classifyFileType(entry.name)} size={16} className={css.fileIcon} />
          <span className={css.name}>{entry.name}</span>
        </button>
      </li>
    )
  }
  return (
    <li className={css.item} data-files-entry="other" data-files-path={path}>
      <span className={clsx(css.row, css.other)} aria-disabled="true" title={tree.t('entry.other')}>
        <span className={css.name}>{entry.name}</span>
      </span>
    </li>
  )
}

/** One directory's rows: its state while listing, its entries once listed. */
export function Level({ path, tree }: { path: string; tree: TreeContext }): ReactNode {
  const { state, t } = tree
  const level = state.levels[path]
  if (level === undefined || level.kind === 'loading') {
    return <li className={css.note} data-files-row="loading">{t('loading')}</li>
  }
  if (level.kind === 'failed') {
    return (
      <li className={css.note} data-files-row="failed" data-files-code={level.failure.code}>
        {failureLine(t, level.failure)}
      </li>
    )
  }
  const entries = orderEntries(level.level.entries)
  return (
    <>
      {entries.length === 0 && <li className={css.note} data-files-row="empty">{t('empty')}</li>}
      {entries.map(entry => <Entry key={entry.name} parent={path} entry={entry} tree={tree} />)}
      {level.level.truncated && <li className={css.note} data-files-row="truncated">{t('truncated')}</li>}
    </>
  )
}

/**
 * One tree's rows under its root level.
 * @param root - absolute path of the tree's root directory.
 * @param tree - the tree's state and gestures.
 * @returns the root level's list.
 */
export function TreeList({ root, tree }: { root: string; tree: TreeContext }): ReactNode {
  return <ul className={clsx(css.level, css.rootLevel)}><Level path={root} tree={tree} /></ul>
}
