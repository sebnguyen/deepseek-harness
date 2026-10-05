// The token efficiency window: a fixed-column table over every priced
// sessions-list row's served sessionCost fold — one row per session with
// its blended spend per million billed tokens, a fixed-width bar track
// whose fill scales against the priced maximum (its hover and aria name
// give the row's blended rate, its share of the max, and the max itself),
// a Models cell whose hover
// opens the per-model spend listing, and a Tokens cell with the displayed
// billed total. Rows ladder under their parentId roots, latest session
// first at every level; pooled micros-over-tokens rates headline the groups.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconCloseOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { CostModelSpend } from '@deepseek-ai/dsh-session-stats/client'
import {
  displayedRate, efficiencyReading, orderEfficiencyReadings, pooledRates, spendTokens,
  type EfficiencyReading, type IndentedReading,
} from '../contract/cost-metrics.ts'
import { formatTokens, formatUsdMicros } from '../contract/token-format.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './TokenEfficiency.module.css'

interface WindowProps {
  /** The sessions list rows; only displayTitle, parentId, and sessionCost are read. */
  byId: Readonly<Record<string, SessionSummary>>
  t: ChatViewSlotProps['t']
  onClose: () => void
}

/**
 * The Models-cell tooltip text: one pooled spend line per model the
 * session family logged, most expensive first — root plus subagents.
 * @param title - the row's session title.
 * @param count - distinct logged models in the displayed scope.
 * @param entries - the displayed per-model spend rows.
 * @param t - chat locale seat.
 * @returns multi-line label (the bubble renders pre-line).
 */
function modelsTipText(
  title: string,
  count: number,
  entries: ReadonlyArray<[string, CostModelSpend]>,
  t: ChatViewSlotProps['t'],
): string {
  const lines = [t('efficiency.modelsTitle', { title, count })]
  for (const [model, spend] of entries) {
    lines.push(t('efficiency.modelLine', {
      model: model === '' ? t('stats.costModelUnknown') : model,
      amount: formatUsdMicros(spend.costMicros, t),
      tokens: formatTokens(spendTokens(spend), t),
    }))
  }
  return lines.join('\n')
}

/**
 * The bar's value line: the row's blended rate named outright, then its
 * share of the priced maximum the fill's 100% scales against.
 * @param rate - the row's displayed blended rate; null when nothing bills.
 * @param maxRate - the priced maximum blended rate; null when none bills.
 * @param t - chat locale seat.
 * @returns the one-line label shared by the hover and the aria name.
 */
function barValueLine(
  rate: number | null,
  maxRate: number | null,
  t: ChatViewSlotProps['t'],
): string {
  const percent = maxRate !== null && maxRate > 0 && rate !== null
    ? Math.round((rate / maxRate) * 100)
    : 0
  return `${t('efficiency.barValue')} — ${t('stats.costPerMillion', { amount: formatUsdMicros(rate ?? 0, t) })} · ${t('efficiency.barShare', { percent })}`
}

/**
 * The bar hover text: the value line, then the maximum blended rate the
 * fill's 100% scales against.
 * @param rate - the row's displayed blended rate; null when nothing bills.
 * @param maxRate - the priced maximum blended rate; null when none bills.
 * @param t - chat locale seat.
 * @returns the two-line label.
 */
function barTipText(
  rate: number | null,
  maxRate: number | null,
  t: ChatViewSlotProps['t'],
): string {
  return [
    barValueLine(rate, maxRate, t),
    `${t('efficiency.barMax')} — ${t('stats.costPerMillion', { amount: formatUsdMicros(maxRate ?? 0, t) })}`,
  ].join('\n')
}

/** The row's display values: the family rollup on roots, the own fold below. */
function viewOf(row: IndentedReading) {
  return row.family ?? {
    micros: row.costMicros,
    tokens: row.tokens,
    rate: row.rateMicros,
    models: row.models,
    cacheHit: row.cacheHit,
    entries: row.spendEntries,
  }
}

/** One table row of the efficiency listing. */
function TableRow({ row, maxRate, t, canExpand, open, onToggle }: {
  row: IndentedReading
  maxRate: number | null
  t: ChatViewSlotProps['t']
  canExpand: boolean
  open: boolean
  onToggle: (id: string) => void
}) {
  const view = viewOf(row)
  const widthPercent = view.rate !== null && maxRate !== null && maxRate > 0
    ? Math.round((view.rate / maxRate) * 100)
    : 0
  return (
    <tr className={row.depth > 0 ? css.child : undefined}>
      <td className={css.name}>
        {canExpand
          ? (
            <button
              type="button"
              className={css.caret}
              aria-expanded={open}
              aria-label={open
                ? t('efficiency.collapse', { title: row.title })
                : t('efficiency.expand', { title: row.title })}
              onClick={() => { onToggle(row.id) }}
            >
              {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
            </button>
          )
          : <span className={css.caretSlot} aria-hidden="true" />}
        {Array.from({ length: row.depth }, (_, index) => <span key={index} aria-hidden>{t('efficiency.childPrefix')}</span>)}
        {row.title}
      </td>
      <td className={css.cnt}>
        <Tooltip label={() => modelsTipText(row.title, view.models, view.entries, t)} side="top">
          <span className={css.dotted} tabIndex={0}>{view.models}</span>
        </Tooltip>
      </td>
      <td>
        <Tooltip label={() => barTipText(view.rate, maxRate, t)} side="top">
          <span
            className={css.track}
            tabIndex={0}
            aria-label={barValueLine(view.rate, maxRate, t)}
          >
            <i className={css.fill} style={{ width: `${widthPercent}%` }} />
          </span>
        </Tooltip>
      </td>
      <td className={css.num}>{formatUsdMicros(view.rate ?? 0, t)}</td>
      <td className={css.num}>{formatUsdMicros(view.micros, t)}</td>
      <td className={css.num}>{formatTokens(view.tokens, t)}</td>
      <td className={css.num}>{view.cacheHit !== null ? `${view.cacheHit}%` : ''}</td>
    </tr>
  )
}

/**
 * The portaled efficiency window: header, pooled group rates, and the
 * fixed-column session table; Escape, mask click, and the header button
 * close it.
 * @param props - list rows, locale seat, close callback.
 * @returns the portaled dialog.
 */
export function TokenEfficiencyWindow({ byId, t, onClose }: WindowProps) {
  const readings = useMemo(() => {
    const list: EfficiencyReading[] = []
    for (const [id, row] of Object.entries(byId)) {
      const cost = row.projectionValues?.sessionCost
      if (cost !== undefined) list.push(efficiencyReading(id, row, cost))
    }
    return list
  }, [byId])
  const ordered = useMemo(() => orderEfficiencyReadings(readings), [readings])
  const pooled = useMemo(() => pooledRates(ordered), [ordered])
  const maxRate = useMemo(
    () => ordered.reduce<number | null>(
      (max, row) => {
        const rate = displayedRate(row)
        return rate !== null && (max === null || rate > max) ? rate : max
      },
      null,
    ),
    [ordered],
  )
  const closeButton = useRef<HTMLButtonElement | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const hasChildren = useMemo(() => {
    const ids = new Set<string>()
    for (const reading of readings) {
      if (reading.parentId !== null) ids.add(reading.parentId)
    }
    return ids
  }, [readings])
  // A row renders when every ancestor above it is expanded: roots always,
  // descendants under their nearest ladder root's accordion state.
  const visible = useMemo(() => {
    const shown = new Map<string, boolean>()
    return ordered.filter((row) => {
      const isShown = row.depth === 0
        || (shown.get(row.parentId ?? '') === true && expanded.has(row.parentId ?? ''))
      shown.set(row.id, isShown)
      return isShown
    })
  }, [ordered, expanded])
  const toggle = (id: string): void => {
    setExpanded(prev => new Set(prev.has(id) ? [...prev].filter(x => x !== id) : [...prev, id]))
  }
  // Entering the dialog focuses the close button.
  useEffect(() => { closeButton.current?.focus() }, [])
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [onClose])
  return createPortal(
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('efficiency.title')}>
        <div className={css.headTitle}>
          <span>{t('efficiency.title')}</span>
          <button
            ref={closeButton}
            type="button"
            className={css.close}
            aria-label={t('efficiency.close')}
            onClick={onClose}
          >
            <IconCloseOutline16 size={14} />
          </button>
        </div>
        <p className={css.sub}>{t('efficiency.sub')}</p>
        <div className={css.chips}>
          {pooled.multi !== null && (
            <span>{t('efficiency.pooledMulti', { amount: formatUsdMicros(pooled.multi.rate ?? 0, t) })}</span>
          )}
          {pooled.single !== null && (
            <span>{t('efficiency.pooledSingle', { amount: formatUsdMicros(pooled.single.rate ?? 0, t) })}</span>
          )}
          <span>{t('efficiency.priced', { count: pooled.priced })}</span>
        </div>
        {ordered.length === 0
          ? <div className={css.empty}>{t('efficiency.empty')}</div>
          : (
            <table className={css.table}>
              <colgroup>
                <col className={css.cName} />
                <col className={css.cModels} />
                <col className={css.cBar} />
                <col className={css.cRate} />
                <col className={css.cSpend} />
                <col className={css.cTokens} />
                <col className={css.cHit} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">{t('efficiency.colSession')}</th>
                  <th scope="col" className={css.cnt}>{t('efficiency.colModels')}</th>
                  <th scope="col">{t('efficiency.colBar')}</th>
                  <th scope="col" className={css.num}>{t('efficiency.colRate')}</th>
                  <th scope="col" className={css.num}>{t('efficiency.colSpend')}</th>
                  <th scope="col" className={css.num}>{t('efficiency.colTokens')}</th>
                  <th scope="col" className={css.num}>{t('efficiency.colHit')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => (
                  <TableRow
                    key={row.id}
                    row={row}
                    maxRate={maxRate}
                    t={t}
                    canExpand={hasChildren.has(row.id)}
                    open={expanded.has(row.id)}
                    onToggle={toggle}
                  />
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>,
    document.body,
  )
}
