// The token efficiency window: a fixed-column table over every priced
// sessions-list row's served sessionCost fold — one row per session with
// its blended spend per million billed tokens, a fixed-width bar track
// whose fill scales against the priced maximum (its hover names the value
// as a share of the max plus the max itself), and a Models cell whose
// hover opens the per-model spend listing. Rows ladder under their
// parentId roots; pooled micros-over-tokens rates headline the groups.

import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  efficiencyReading, orderEfficiencyReadings, pooledRates, spendTokens,
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
 * The Models-cell tooltip text: one spend-not-rates line per logged model,
 * most expensive first — the spend dialog's model rows for this session.
 * @param reading - the row's efficiency reading.
 * @param t - chat locale seat.
 * @returns multi-line label (the bubble renders pre-line).
 */
function modelsTipText(reading: EfficiencyReading, t: ChatViewSlotProps['t']): string {
  const lines = [t('efficiency.modelsTitle', { title: reading.title, count: reading.models })]
  for (const [model, spend] of reading.spendEntries) {
    lines.push(t('efficiency.modelLine', {
      model: model === '' ? t('stats.costModelUnknown') : model,
      amount: formatUsdMicros(spend.costMicros, t),
      tokens: formatTokens(spendTokens(spend), t),
    }))
  }
  return lines.join('\n')
}

/**
 * The bar hover text: this row's value as a share of the priced maximum,
 * then the maximum blended rate the fill's 100% scales against.
 * @param reading - the row's efficiency reading.
 * @param maxRate - the priced maximum blended rate; null when none bills.
 * @param t - chat locale seat.
 * @returns the two-line label.
 */
function barTipText(
  reading: EfficiencyReading,
  maxRate: number | null,
  t: ChatViewSlotProps['t'],
): string {
  const percent = maxRate !== null && maxRate > 0 && reading.rateMicros !== null
    ? Math.round((reading.rateMicros / maxRate) * 100)
    : 0
  return [
    `${t('efficiency.barValue')} — ${t('efficiency.barShare', { percent })}`,
    `${t('efficiency.barMax')} — ${t('stats.costPerMillion', { amount: formatUsdMicros(maxRate ?? 0, t) })}`,
  ].join('\n')
}

/** One table row of the efficiency listing. */
function TableRow({ row, maxRate, t }: {
  row: IndentedReading
  maxRate: number | null
  t: ChatViewSlotProps['t']
}) {
  const widthPercent = row.rateMicros !== null && maxRate !== null && maxRate > 0
    ? Math.round((row.rateMicros / maxRate) * 100)
    : 0
  return (
    <tr className={row.depth > 0 ? css.child : undefined}>
      <td className={css.name}>
        {row.depth > 0 && <span aria-hidden>{t('efficiency.childPrefix')}</span>}
        {row.title}
      </td>
      <td className={css.cnt}>
        <Tooltip label={() => modelsTipText(row, t)} side="top">
          <span className={css.dotted} tabIndex={0}>{row.models}</span>
        </Tooltip>
      </td>
      <td>
        <Tooltip label={() => barTipText(row, maxRate, t)} side="top">
          <span
            className={css.track}
            tabIndex={0}
            aria-label={t('efficiency.barShare', { percent: widthPercent })}
          >
            <i className={css.fill} style={{ width: `${widthPercent}%` }} />
          </span>
        </Tooltip>
      </td>
      <td className={css.num}>{formatUsdMicros(row.rateMicros ?? 0, t)}</td>
      <td className={css.num}>{formatUsdMicros(row.costMicros, t)}</td>
      <td className={css.num}>{row.cacheHit !== null ? `${row.cacheHit}%` : ''}</td>
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
  const pooled = useMemo(() => pooledRates(readings), [readings])
  const maxRate = useMemo(
    () => ordered.reduce<number | null>(
      (max, row) => row.rateMicros !== null && (max === null || row.rateMicros > max)
        ? row.rateMicros
        : max,
      null,
    ),
    [ordered],
  )
  const closeButton = useRef<HTMLButtonElement | null>(null)
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
                <col className={css.cHit} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">{t('efficiency.colSession')}</th>
                  <th scope="col" className={css.cnt}>{t('efficiency.colModels')}</th>
                  <th scope="col">{t('efficiency.colBar')}</th>
                  <th scope="col" className={css.num}>{t('efficiency.colRate')}</th>
                  <th scope="col" className={css.num}>{t('efficiency.colSpend')}</th>
                  <th scope="col" className={css.num}>{t('efficiency.colHit')}</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map(row => (
                  <TableRow key={row.id} row={row} maxRate={maxRate} t={t} />
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>,
    document.body,
  )
}
