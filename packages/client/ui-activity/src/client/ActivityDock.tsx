/**
 * The background-activity chip and its drawer, docked in the sticky composer
 * stack directly below the input bar (bottom-of-screen drawer): opening it
 * grows the stack, so the input slides up above the drawer while the
 * transcript's visible area shrinks. The chip counts live work; the drawer
 * renders the ownership tree (live rows, then an archive) beside the selected
 * row's detail — a terminal tail for jobs, an opening into the full session
 * view for subagents. All data arrives through the Session Controller
 * mirrors; the plugin issues no RPC of its own.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { SessionJob as JobView } from '@deepseek-ai/dsh-api-session-controller/types'
import { IconChevronDownOutline14, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import {
  durationParts, isLive, jobRow, rowKey, sections, statusKey, subagentRows, type ActivityRow,
} from './model.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './ActivityDock.module.css'

/** Callbacks the apply closure supplies from the sessions service. */
export interface ActivityDockInjected {
  /** Pull the parent catalog so subagent rows gain labels and descriptor modes. */
  onRefresh: () => void
  /** Route the selected child session through its direct-parent address. */
  onOpenChild: (childId: string) => void
}

/** Full props for the input-dock activity entry. */
export type ActivityDockProps =
  & PropsRuntime<'conversation.composer.dock'>
  & InjectFace<ActivityDockInjected>
  & PropsLocale<typeof NS>

/** Stable empty slices so an idle session keeps one array identity. */
const NO_JOBS: readonly JobView[] = []

/** Status marker semantics; `stopping` and `killed` share the attention color. */
function dotState(status: ActivityRow['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'killed': return 'warning'
    case 'failed': return 'error'
    case 'inactive': return 'done'
  }
}

/** Human duration in at most two adjacent units, from the split parts. */
function durationText(elapsedMs: number, t: TranslateNS<typeof NS>): string {
  const { hours, minutes, seconds } = durationParts(elapsedMs)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
}

/**
 * The chip plus, while open, the drawer beneath it. Renders nothing until the
 * session owns at least one background item, so an ordinary conversation
 * never grows a control for a capability it is not using.
 * @param props - runtime slot currency, the injected session callbacks, and the namespace translator.
 * @returns the chip and drawer, or null when there is nothing to show.
 */
export function ActivityDock({
  sessionId, useSessions, onRefresh, onOpenChild, t,
}: ActivityDockProps) {
  // An addressed child session keeps no chip of its own: its activity already
  // reads as a Live row in the owner's drawer, and one dock per tree keeps the
  // chip in exactly one place on every view.
  const isAddressedChild = useSessions(state =>
    state.currentAddress !== undefined
    && state.byId[sessionId]?.origin === 'subagent')
  const jobs = useSessions(state => (isAddressedChild ? NO_JOBS : state.jobsBySession[sessionId])) ?? NO_JOBS
  const catalog = useSessions(state => (isAddressedChild ? undefined : state.subagentsByParent[sessionId]))
  const summaries = useSessions(state => state.byId)

  const [open, setOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [aliveOnly, setAliveOnly] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const chipRef = useRef<HTMLButtonElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  const split = useMemo(
    () => sections([...jobs.map(jobRow), ...subagentRows(catalog, summaries, sessionId)]),
    [jobs, catalog, summaries, sessionId],
  )
  const total = split.live.length + split.archive.length
  const catalogReady = catalog?.state === 'ready'
  const hasChildCatalog = (id: string): boolean =>
    catalog !== undefined && catalog.state === 'ready'
    && catalog.entries.some(entry => entry.kind === 'child' && entry.id === id)

  const selected = selectedKey === undefined
    ? undefined
    : [...split.live, ...split.archive].find(row => rowKey(row) === selectedKey)

  // The catalog is pulled, not pushed: ask once per open so subagent rows gain
  // labels and modes, and report interest while the drawer is being watched.
  const hasChildren = split.archive.length + split.live.length > jobs.length
  useEffect(() => {
    if (!open || !hasChildren) return
    onRefresh()
  }, [open, hasChildren, onRefresh, catalogReady])

  // The clock only runs while an open drawer is showing something that moves.
  const anyLive = split.live.length > 0
  useEffect(() => {
    if (!open || !anyLive) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { clearInterval(timer) }
  }, [open, anyLive])

  // The last row disappearing removes this control; close first so focus
  // does not vanish from an unmounting node.
  useEffect(() => {
    if (total === 0 && open) setOpen(false)
  }, [total, open])

  if (total === 0) return null

  const liveCount = split.live.length
  const countKey = liveCount > 0
    ? (liveCount === 1 ? 'chip.live.one' : 'chip.live.other')
    : (total === 1 ? 'chip.idle.one' : 'chip.idle.other')

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      chipRef.current?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    /* v8 ignore next 2 -- the drawer renders only while it owns rows, and the
       tree ref exists for the drawer's lifetime, so both guards never fire */
    const rows = [...(treeRef.current?.querySelectorAll('button[data-activity-row]') ?? [])] as HTMLElement[]
    if (rows.length === 0) return
    event.preventDefault()
    const current = rows.findIndex(row => row === document.activeElement)
    const next = event.key === 'ArrowDown'
      ? Math.min(rows.length - 1, current + 1)
      : Math.max(0, current === -1 ? rows.length - 1 : current - 1)
    rows[next]?.focus()
  }

  const visibleArchive = aliveOnly ? [] : split.archive

  const renderRow = (row: ActivityRow): React.JSX.Element => {
    const live = isLive(row.status)
    const showDuration = row.domain === 'job' || live
    const elapsed = live ? now - row.startedAt : (row.finishedAt ?? row.startedAt) - row.startedAt
    const duration = durationText(elapsed, t)
    const status = row.detail ?? t(statusKey(row.status))
    const key = rowKey(row)
    return (
      <li key={key}>
        <button
          type="button"
          data-activity-row={key}
          data-testid={`activity-row-${key}`}
          className={[css.row, live ? '' : css.rowSettled, selectedKey === key ? css.rowOpen : ''].filter(Boolean).join(' ')}
          aria-pressed={selectedKey === key}
          title={row.label}
          onClick={() => { setSelectedKey(current => current === key ? undefined : key) }}
        >
          <StateDot state={dotState(row.status)} className={css.rowDot} />
          <span className={css.side}>{row.side}</span>
          <span className={css.label}>{row.label}</span>
          <span className={css.status} title={status}>{status}</span>
          {showDuration
            ? (
              <span
                className={css.duration}
                title={t(live ? 'duration.title.live' : 'duration.title.done', { duration })}
              >
                {duration}
              </span>
            )
            : null}
        </button>
      </li>
    )
  }

  return (
    <div className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={chipRef}
        type="button"
        className={css.chip}
        aria-expanded={open}
        aria-label={t(countKey, { count: liveCount > 0 ? liveCount : total })}
        onClick={() => {
          // Sample the clock in the same commit that opens the drawer: the
          // mount-time value predates every row, so the first painted frame
          // would otherwise clamp a long-running duration to zero.
          setNow(Date.now())
          setOpen(current => !current)
        }}
      >
        {liveCount > 0 ? <StateDot state="ongoing" className={css.chipDot} /> : null}
        <span className={css.count}>{t(countKey, { count: liveCount > 0 ? liveCount : total })}</span>
        <IconChevronDownOutline14 className={open ? css.chipOpen : undefined} />
      </button>
      <div className={css.wrap} data-open={open} aria-hidden={!open}>
        <div className={css.drawer} role="region" aria-label={t('drawer.aria')}>
          <div className={css.tree} ref={treeRef}>
            <div className={css.treeHead}>
              <span>{t('section.live')}</span>
              <button
                type="button"
                className={[css.filter, aliveOnly ? css.filterOn : ''].filter(Boolean).join(' ')}
                aria-pressed={aliveOnly}
                onClick={() => { setAliveOnly(current => !current) }}
              >
                {t('filter.alive')}
              </button>
            </div>
            {split.live.length > 0
              ? (
                <ul className={css.rows} aria-label={t('tree.live.aria')}>
                  {split.live.map(renderRow)}
                </ul>
              )
              : null}
            {!aliveOnly && split.archive.length > 0
              ? (
                <>
                  <button
                    type="button"
                    className={css.sectionButton}
                    aria-expanded={archiveOpen}
                    onClick={() => { setArchiveOpen(current => !current) }}
                  >
                    {t('section.archive', { count: split.archive.length })}
                  </button>
                  {archiveOpen
                    ? (
                      <ul className={css.rows} aria-label={t('tree.archive.aria')}>
                        {visibleArchive.map(renderRow)}
                      </ul>
                    )
                    : null}
                </>
              )
              : null}
          </div>
          <div className={css.detail} aria-label={t('detail.aria')}>
            {selected === undefined
              ? <p className={css.detailEmpty}>{t('detail.empty')}</p>
              : selected.domain === 'job'
                ? <p className={css.detailEmpty}>{selected.detail ?? t(statusKey(selected.status))}</p>
                : (
                  <>
                    <p className={css.detailEmpty}>{t(statusKey(selected.status))}</p>
                    <button
                      type="button"
                      className={css.openSession}
                      disabled={!hasChildCatalog(selected.id)}
                      onClick={() => { onOpenChild(selected.id) }}
                    >
                      {t('open.session')}
                    </button>
                  </>
                )}
          </div>
        </div>
      </div>
    </div>
  )
}
