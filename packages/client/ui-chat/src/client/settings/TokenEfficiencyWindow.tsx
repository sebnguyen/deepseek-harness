// The token efficiency window: a fixed-column table over every priced
// sessions-list row's served sessionCost fold — one row per session with
// its token-mix bar over the four billed buckets, its blended spend per
// million billed tokens, and that rate stated as a multiple of the three
// whole-table anchors (the median root-family rate, the pooled average,
// the priced maximum), each in its own column; hit, spend, billed
// tokens, and the model count follow as plain numeric columns. Rows
// ladder under their parentId roots, latest session first at every
// level; headline tiles name the anchors and the pooled spend.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconCloseOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { CostModelSpend } from '@deepseek-ai/dsh-session-stats/client'
import {
  efficiencyAnchors, efficiencyReading, formatMultiple, mixPercents, multipleBand,
  orderEfficiencyReadings, spendTokens,
  type EfficiencyAnchors, type EfficiencyReading, type IndentedReading,
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

/** The row's display values: the family rollup on roots, the own fold below. */
function viewOf(row: IndentedReading) {
  return row.family ?? {
    micros: row.costMicros,
    tokens: row.tokens,
    rate: row.rateMicros,
    models: row.models,
    cacheHit: row.cacheHit,
    entries: row.spendEntries,
    mix: row.mix,
  }
}

/** One anchored multiple column cell: a banded ×N chip, or a dash with no anchor. */
function MultipleCell({ rate, anchor, tipKey, t }: {
  rate: number | null
  anchor: number | null
  tipKey: 'efficiency.tipMedian' | 'efficiency.tipAvg' | 'efficiency.tipMax'
  t: ChatViewSlotProps['t']
}) {
  if (rate === null || anchor === null || anchor <= 0) {
    return <td><span className={css.none}>{t('efficiency.none')}</span></td>
  }
  const multiple = rate / anchor
  const band = multipleBand(multiple)
  const label = t('efficiency.multiple', { multiple: formatMultiple(multiple) })
  const tip = t(tipKey, {
    value: t('stats.costPerMillion', { amount: formatUsdMicros(rate, t) }),
    anchor: t('stats.costPerMillion', { amount: formatUsdMicros(anchor, t) }),
  })
  return (
    <td>
      <Tooltip label={() => tip} side="top">
        <span tabIndex={0} className={css[band]}>{label}</span>
      </Tooltip>
    </td>
  )
}

/** The mix-bar cell: four bucket segments scaled to the row's billed total. */
function MixCell({ mix, tokens, t }: {
  mix: { uncached: number; cacheRead: number; cacheWrite: number; output: number }
  tokens: number
  t: ChatViewSlotProps['t']
}) {
  const percents = mixPercents(mix, tokens)
  if (percents === null) return <td><span className={css.trackEmpty} aria-hidden="true" /></td>
  const tip = t('efficiency.mixTip', {
    uncached: `${percents[0]}%`,
    cacheRead: `${percents[1]}%`,
    cacheWrite: `${percents[2]}%`,
    output: `${percents[3]}%`,
  })
  return (
    <td>
      <Tooltip label={() => tip} side="top">
        <span tabIndex={0} className={css.mix} aria-label={tip}>
          <i className={css.mixUncached} style={{ width: `${percents[0]}%` }} />
          <i className={css.mixCacheRead} style={{ width: `${percents[1]}%` }} />
          <i className={css.mixCacheWrite} style={{ width: `${percents[2]}%` }} />
          <i className={css.mixOutput} style={{ width: `${percents[3]}%` }} />
        </span>
      </Tooltip>
    </td>
  )
}

/** One table row of the efficiency listing. */
function TableRow({ row, anchors, t, canExpand, open, onToggle }: {
  row: IndentedReading
  anchors: EfficiencyAnchors
  t: ChatViewSlotProps['t']
  canExpand: boolean
  open: boolean
  onToggle: (id: string) => void
}) {
  const view = viewOf(row)
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
      <MixCell mix={view.mix} tokens={view.tokens} t={t} />
      <td className={css.num}>{formatUsdMicros(view.rate ?? 0, t)}</td>
      <MultipleCell rate={view.rate} anchor={anchors.median} tipKey="efficiency.tipMedian" t={t} />
      <MultipleCell rate={view.rate} anchor={anchors.average?.rate ?? null} tipKey="efficiency.tipAvg" t={t} />
      <MultipleCell rate={view.rate} anchor={anchors.max} tipKey="efficiency.tipMax" t={t} />
      <td className={css.num}>{view.cacheHit !== null ? `${view.cacheHit}%` : ''}</td>
      <td className={css.num}>{formatUsdMicros(view.micros, t)}</td>
      <td className={css.num}>{formatTokens(view.tokens, t)}</td>
      <td className={css.num}>
        <Tooltip label={() => modelsTipText(row.title, view.models, view.entries, t)} side="top">
          <span className={css.dotted} tabIndex={0}>{view.models}</span>
        </Tooltip>
      </td>
    </tr>
  )
}

/**
 * The portaled efficiency window: header tiles over the three anchors,
 * the fixed-column session table, and the mix legend; Escape, mask
 * click, and the header button close it.
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
  const anchors = useMemo(() => efficiencyAnchors(ordered), [ordered])
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
  const rate = (value: number | null): string =>
    t('stats.costPerMillion', { amount: formatUsdMicros(value ?? 0, t) })
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
        <div className={css.tiles}>
          <div>
            <span className={css.tileKey}>{t('efficiency.tileSpend')}</span>
            <span className={css.tileValue}>
              {t('efficiency.tileSpendValue', {
                amount: formatUsdMicros(anchors.average?.micros ?? 0, t),
                tokens: formatTokens(anchors.average?.tokens ?? 0, t),
              })}
            </span>
          </div>
          <div>
            <span className={css.tileKey}>{t('efficiency.tileMedian')}</span>
            <span className={css.tileValue}>{rate(anchors.median)}</span>
          </div>
          <div>
            <span className={css.tileKey}>{t('efficiency.tileAvg')}</span>
            <span className={css.tileValue}>{rate(anchors.average?.rate ?? null)}</span>
          </div>
          <div>
            <span className={css.tileKey}>{t('efficiency.tileMax')}</span>
            <span className={css.tileValue}>{rate(anchors.max)}</span>
          </div>
        </div>
        {ordered.length === 0
          ? <div className={css.empty}>{t('efficiency.empty')}</div>
          : (
            <>
              <table className={css.table}>
                <colgroup>
                  <col className={css.cName} />
                  <col className={css.cMix} />
                  <col className={css.cRate} />
                  <col className={css.cMedian} />
                  <col className={css.cAvg} />
                  <col className={css.cMax} />
                  <col className={css.cHit} />
                  <col className={css.cSpend} />
                  <col className={css.cTokens} />
                  <col className={css.cModels} />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">{t('efficiency.colSession')}</th>
                    <th scope="col">{t('efficiency.colMix')}</th>
                    <th scope="col" className={css.num}>{t('efficiency.colRate')}</th>
                    <th scope="col">{t('efficiency.colMedian')}</th>
                    <th scope="col">{t('efficiency.colAvg')}</th>
                    <th scope="col">{t('efficiency.colMax')}</th>
                    <th scope="col" className={css.num}>{t('efficiency.colHit')}</th>
                    <th scope="col" className={css.num}>{t('efficiency.colSpend')}</th>
                    <th scope="col" className={css.num}>{t('efficiency.colTokens')}</th>
                    <th scope="col" className={css.num}>{t('efficiency.colModels')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(row => (
                    <TableRow
                      key={row.id}
                      row={row}
                      anchors={anchors}
                      t={t}
                      canExpand={hasChildren.has(row.id)}
                      open={expanded.has(row.id)}
                      onToggle={toggle}
                    />
                  ))}
                </tbody>
              </table>
              <div className={css.legend}>
                <span><i className={css.mixUncached} />{t('efficiency.mixUncached')}</span>
                <span><i className={css.mixCacheRead} />{t('efficiency.mixCacheRead')}</span>
                <span><i className={css.mixCacheWrite} />{t('efficiency.mixCacheWrite')}</span>
                <span><i className={css.mixOutput} />{t('efficiency.mixOutput')}</span>
                <span className={css.legendBands}>{t('efficiency.legendBands')}</span>
              </div>
            </>
          )}
      </div>
    </div>,
    document.body,
  )
}
