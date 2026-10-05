// Session stats under the composer, split into three readings: a gauge pill
// (turn/step counts + average and last-request output speed) opening the
// time-and-speed dialog, a database pill (input/cache/output token buckets
// + cache hit) opening the token-usage dialog, and a cost pill (total spend
// + the live blended rate per million tokens) opening the spend dialog, whose
// rows list the cache hit and the per-model spend, rolling the viewed
// session's subagent descendants in through the list rows' parent chains.
// Settled-node identity prevents stream-delta updates from rerendering the row.
// Mounted on 'conversation.composer.dock' so it sticks with the composer in the
// active conversation scrollport (see ConversationRoot data-conversation-scroll).

import { Fragment, memo, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconDataOutline16, IconDatabaseOutline16, IconGaugeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionSummary, UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: merges the sessionStats key into SessionProjectionMap for useProjection.
import type { CostModelSpend, SessionCostProjection } from '@deepseek-ai/dsh-session-stats/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { assistantStepReading } from '../contract/turn-metrics.ts'
import { perMillionMicros, sortedSpendEntries, spendTokens } from '../contract/cost-metrics.ts'
import { formatCacheHitPercent, formatExactTokens, formatTokens, formatUsdMicros } from '../contract/token-format.ts'
import { MEASURE_STYLE, useStatDialog, type StatDialogSeat } from './stat-dialog.ts'
import css from './StatsPills.module.css'
import dialogCss from './stat-dialog.module.css'

interface WindowStats {
  turns: number
  steps: number
  /** Summed request wall time (step/start → assistant/message); 0 when no node carries timing. */
  llmMs: number
  /** Summed tool wall time (tool/call → tool/result); 0 when no pair is in-window. */
  toolMs: number
  /** Summed first-token latency over `ttftSteps`; 0 when no step records it. */
  ttftMs: number
  /** Steps carrying a recorded TTFT. */
  ttftSteps: number
  /** Summed decode wall time over steps that also report output tokens. */
  decodeMs: number
  /** Summed output tokens over the same decode-timed steps. */
  decodeTokens: number
}

/**
 * Fold assistant and tool-result nodes into window-scoped display totals —
 * the FALLBACK for assemblies without the `sessionStats` projection.
 *
 * Every displayed figure rides that durable whole-log projection (and token
 * accounting rides `tokenUsage`) because the window is paged and compaction
 * rewrites it; this fold answers "what is on screen" only when no projection
 * value is served. Its field names deliberately mirror the projection's so
 * the two swap wholesale.
 * @param nodes - snapshot nodes.
 * @returns fallback counts and summed wall times.
 */
export function deriveStats(nodes: ChatSnapshot['legacy']['nodes']): WindowStats {
  const turns = new Set<number>()
  let steps = 0
  let llmMs = 0
  let toolMs = 0
  let ttftMs = 0
  let ttftSteps = 0
  let decodeMs = 0
  let decodeTokens = 0
  for (const node of nodes) {
    if (node.kind === 'tool-result') {
      if (node.callTime !== null) toolMs += Math.max(0, node.time - node.callTime)
      continue
    }
    if (node.kind !== 'assistant') continue
    turns.add(node.turn)
    steps += 1
    if (node.timing !== undefined && node.timing.stepStartTime !== null) {
      llmMs += Math.max(0, node.timing.completedTime - node.timing.stepStartTime)
    }
    const reading = assistantStepReading(node)
    if (reading.ttftMs !== null) {
      ttftMs += reading.ttftMs
      ttftSteps += 1
    }
    if (reading.decodeMs !== null && reading.outputTokens !== null) {
      decodeMs += reading.decodeMs
      decodeTokens += reading.outputTokens
    }
  }
  return { turns: turns.size, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
export function formatDuration(ms: number, t: ChatViewSlotProps['t']): string {
  const s = ms / 1_000
  if (s < 60) return t('duration.compactSeconds', { seconds: Math.round(s * 10) / 10 })
  const whole = Math.round(s)
  return t('duration.compactMinutes', {
    minutes: Math.floor(whole / 60),
    seconds: whole % 60,
  })
}

/**
 * Decode throughput of the most recent settled request: the newest assistant
 * node carrying both decode timing and provider usage (the window tail is the
 * newest settled step), keeping a current-speed reading beside the pooled
 * whole-session average.
 * @param nodes - snapshot nodes of the loaded window.
 * @returns that request's tok/s, or null when no settled step carries both.
 */
export function lastRequestTps(nodes: ChatSnapshot['legacy']['nodes']): number | null {
  for (const node of [...nodes].reverse()) {
    if (node.kind !== 'assistant') continue
    const reading = assistantStepReading(node)
    if (reading.decodeMs === null || reading.outputTokens === null || reading.decodeMs <= 0) continue
    return reading.outputTokens / (reading.decodeMs / 1_000)
  }
  return null
}

/**
 * Display-ready cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token-usage projection value.
 * @returns integer text when integer rounding stays below 100, otherwise the
 * minimum decimal precision that still rounds below 100; a full hit returns
 * 100, and no billed input returns null.
 */
export function cacheHitPercent(usage: TokenUsageProjection): string | null {
  const denominator = billedInputTokens(usage)
  return formatCacheHitPercent(usage.cacheReadTokens, denominator)
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Props: the conversation-snapshot selector plus the projection read seat. */
export interface StatsPillsProps {
  useChat: SnapshotSelectorHook<ChatSnapshot>
  useProjection: UseProjection
  /** The viewed session's identity (framework session kit). */
  sessionId: SessionId
  /** The sessions list standard seat (descendant spend rollup). */
  useSessions: UseSessions
  /** The owning dock's locale seat. */
  t: ChatViewSlotProps['t']
}

function exactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) })
}

/** External open state one pill's dialog reads and writes (the row's exclusive slot). */
type PillDialog = Pick<ReturnType<typeof useStatDialog>, 'open' | 'setOpen'>

/**
 * The button chrome the three pills share: dialog affordance, accessible
 * name from the shown segments, the seat glyph, and the label content.
 * @param seat - the pill's dialog seat.
 * @param segments - shown label segments; the accessible name joins them.
 * @param icon - the pill's seat glyph.
 * @param children - label content.
 * @returns the pill button.
 */
function StatPillButton({ seat, segments, icon, children }: {
  seat: StatDialogSeat
  segments: string[]
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={css.pill}
      aria-haspopup="dialog"
      aria-expanded={seat.open}
      aria-label={segments.join(' · ')}
      onClick={() => { seat.setOpen(!seat.open) }}
    >
      {icon}
      <span className={css.label}>{children}</span>
    </button>
  )
}

/**
 * The portaled dialog chrome the three pills share: heading row with the
 * seat glyph, section name and optional headline value, the rule, then
 * the pill's own rows.
 * @param seat - the pill's dialog seat; closed renders nothing.
 * @param label - the dialog's accessible name.
 * @param icon - the heading's seat glyph.
 * @param title - the heading's section name.
 * @param titleValue - right-aligned headline value; omitted when absent.
 * @param children - the dialog rows.
 * @returns the portaled panel.
 */
function StatDialogPanel({ seat, label, icon, title, titleValue, children }: {
  seat: StatDialogSeat
  label: string
  icon: ReactNode
  title: string
  titleValue?: string
  children: ReactNode
}) {
  if (!seat.open) return null
  return createPortal(
    <div
      ref={seat.panelRef}
      className={dialogCss.panel}
      role="dialog"
      aria-label={label}
      style={seat.pos ?? MEASURE_STYLE}
    >
      <div className={dialogCss.title}>
        <span className={dialogCss.titleLabel}>
          {icon}
          {title}
        </span>
        {titleValue !== undefined && (
          <span className={dialogCss.titleValue}>{titleValue}</span>
        )}
      </div>
      <div className={dialogCss.titleRule} aria-hidden />
      {children}
    </div>,
    document.body,
  )
}

function TimePill({ stats, lastTps, t, dialog }: {
  stats: WindowStats
  /** The most recent settled request's tok/s; null when none is readable. */
  lastTps: number | null
  t: ChatViewSlotProps['t']
  dialog: PillDialog
}) {
  const seat = useStatDialog(dialog)
  const counts = t('stats.counts', { turns: stats.turns, steps: stats.steps })
  const avg = stats.decodeMs > 0
    ? t('stats.avgTps', {
      tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
    })
    : null
  const last = lastTps !== null
    ? t('stats.lastTps', { tps: formatTokensPerSecond(lastTps) })
    : null
  const segments = [counts, avg, last].filter((s): s is string => s !== null)
  const label = (
    <>
      {counts}
      {avg !== null && (
        <>
          <span className={css.sep} aria-hidden>·</span>
          {avg}
        </>
      )}
      {last !== null && (
        <>
          <span className={css.sep} aria-hidden>·</span>
          {last}
        </>
      )}
    </>
  )
  // A window without one timed figure has no dialog rows to show, so the pill
  // stays a plain reading instead of a button opening an empty dialog.
  if (stats.llmMs <= 0 && stats.toolMs <= 0 && stats.ttftSteps <= 0 && stats.decodeMs <= 0) {
    return (
      <span className={css.anchor}>
        <span className={css.pill}>
          <IconGaugeOutline16 />
          <span className={css.label}>{label}</span>
        </span>
      </span>
    )
  }
  return (
    <span ref={seat.rootRef} className={css.anchor}>
      <StatPillButton seat={seat} segments={segments} icon={<IconGaugeOutline16 />}>
        {label}
      </StatPillButton>
      <StatDialogPanel
        seat={seat}
        label={t('stats.dialog.title')}
        icon={<IconGaugeOutline16 />}
        title={t('stats.dialog.title')}
      >
        <dl className={dialogCss.details} data-session-stats-details>
          {stats.llmMs > 0 && (
            <>
              <dt>{t('stats.dialog.llmTime')}</dt>
              <dd>{formatDuration(stats.llmMs, t)}</dd>
            </>
          )}
          {stats.toolMs > 0 && (
            <>
              <dt>{t('stats.dialog.toolTime')}</dt>
              <dd>{formatDuration(stats.toolMs, t)}</dd>
            </>
          )}
          {stats.ttftSteps > 0 && (
            <>
              <dt>{t('stats.dialog.ttft')}</dt>
              <dd>{formatDuration(stats.ttftMs / stats.ttftSteps, t)}</dd>
            </>
          )}
          {stats.decodeMs > 0 && (
            <>
              <dt>{t('stats.dialog.speed')}</dt>
              <dd>{t('message.tokensPerSecond', {
                tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
              })}</dd>
            </>
          )}
          {lastTps !== null && (
            <>
              <dt>{t('stats.dialog.lastSpeed')}</dt>
              <dd>{t('message.tokensPerSecond', { tps: formatTokensPerSecond(lastTps) })}</dd>
            </>
          )}
        </dl>
      </StatDialogPanel>
    </span>
  )
}

function UsagePill({ usage, t, dialog }: {
  usage: TokenUsageProjection
  t: ChatViewSlotProps['t']
  dialog: PillDialog
}) {
  const seat = useStatDialog(dialog)
  // Same aggregate as the Turn pill's totalTokens: every prompt-side billing bucket plus output.
  const total = billedInputTokens(usage) + usage.outputTokens
  const inputText = t('stats.usageInput', { count: formatTokens(usage.uncachedInputTokens, t) })
  const cacheText = t('stats.usageCache', { count: formatTokens(usage.cacheReadTokens, t) })
  const outputText = t('stats.usageOutput', { count: formatTokens(usage.outputTokens, t) })
  const cacheHit = cacheHitPercent(usage)
  const cacheHitText = cacheHit !== null ? t('stats.cacheHit', { percent: cacheHit }) : null
  const segments = cacheHitText === null
    ? [inputText, cacheText, outputText]
    : [inputText, cacheText, outputText, cacheHitText]
  return (
    <span ref={seat.rootRef} className={css.anchor}>
      <StatPillButton seat={seat} segments={segments} icon={<IconDatabaseOutline16 />}>
        {inputText}
        <span className={css.sep} aria-hidden>·</span>
        {cacheText}
        <span className={css.sep} aria-hidden>·</span>
        {outputText}
        {cacheHitText !== null && (
          <>
            <span className={css.sep} aria-hidden>·</span>
            {cacheHitText}
          </>
        )}
      </StatPillButton>
      <StatDialogPanel
        seat={seat}
        label={t('stats.dialog.usageTitle')}
        icon={<IconDatabaseOutline16 />}
        title={t('stats.dialog.usageTitle')}
        titleValue={exactCount(total, t)}
      >
        {/* jscpd:ignore-start -- the session-total bucket rows deliberately mirror
            TurnUsagePanel's per-turn dl: same skin, different data contract (the
            buckets are always present here; per-turn fields are optional). A
            session that never wrote cache drops the row, as the per-turn panel
            drops its absent fields. */}
        <dl className={dialogCss.details} data-session-stats-usage>
          {cacheHit !== null && (
            <>
              <dt>{t('message.turnUsage.cacheHit')}</dt>
              <dd>{`${cacheHit}%`}</dd>
            </>
          )}
          <dt>{t('message.turnUsage.input')}</dt>
          <dd>{exactCount(usage.uncachedInputTokens, t)}</dd>
          <dt>{t('message.turnUsage.cacheRead')}</dt>
          <dd>{exactCount(usage.cacheReadTokens, t)}</dd>
          {usage.cacheWriteTokens !== 0 && (
            <>
              <dt>{t('message.turnUsage.cacheWrite')}</dt>
              <dd>{exactCount(usage.cacheWriteTokens, t)}</dd>
            </>
          )}
          <dt>{t('message.turnUsage.output')}</dt>
          <dd>{exactCount(usage.outputTokens, t)}</dd>
        </dl>
        {/* jscpd:ignore-end */}
      </StatDialogPanel>
    </span>
  )
}

/**
 * Merge per-model spend maps by model key, summing the four token buckets
 * and the micros; the dialog rolls the viewed session's descendants into
 * its own fold through this.
 * @param maps - spend maps to merge.
 * @returns one merged map.
 */
function mergeSpend(maps: ReadonlyArray<Readonly<Record<string, CostModelSpend>>>): Record<string, CostModelSpend> {
  const merged: Record<string, CostModelSpend> = {}
  for (const map of maps) {
    for (const [model, spend] of Object.entries(map)) {
      const prior = merged[model]
      merged[model] = prior === undefined
        ? { ...spend }
        : {
          uncachedInputTokens: prior.uncachedInputTokens + spend.uncachedInputTokens,
          outputTokens: prior.outputTokens + spend.outputTokens,
          cacheReadTokens: prior.cacheReadTokens + spend.cacheReadTokens,
          cacheWriteTokens: prior.cacheWriteTokens + spend.cacheWriteTokens,
          costMicros: prior.costMicros + spend.costMicros,
        }
    }
  }
  return merged
}

/**
 * The session ids one spend rollup covers: the viewed session plus every
 * descendant the list rows connect through `parentId` (subagent sessions
 * ride the list whether or not they were opened). A cyclic chain is cut at
 * its first repeated id.
 * @param byId - the sessions list rows.
 * @param self - the viewed session id.
 * @returns self first, then descendants in list order.
 */
function spendScopeIds(byId: Readonly<Record<string, SessionSummary>>, self: SessionId): SessionId[] {
  const ids: SessionId[] = [self]
  const seen = new Set<SessionId>([self])
  for (const id of ids) {
    for (const [candidate, row] of Object.entries(byId)) {
      const child = candidate as SessionId
      if (row.parentId === id && !seen.has(child)) {
        seen.add(child)
        ids.push(child)
      }
    }
  }
  return ids
}

/** The spend dialog listing: merged per-model spend plus the rollup extent. */
interface SpendRollup {
  /** Per-model spend over the viewed session and its priced descendants. */
  merged: Record<string, CostModelSpend>
  /** Descendant sessions the rollup spans (priced or not). */
  descendants: number
}

/**
 * Fold the viewed session's per-model spend together with every descendant
 * session the list rows connect beneath it; a descendant without a served
 * `sessionCost` adds no rows and no micros but still counts as included.
 * @param cost - the viewed session's served sessionCost value.
 * @param byId - the sessions list rows.
 * @param self - the viewed session id.
 * @returns the merged listing inputs.
 */
function costRollup(
  cost: SessionCostProjection,
  byId: Readonly<Record<string, SessionSummary>>,
  self: SessionId,
): SpendRollup {
  const ids = spendScopeIds(byId, self)
  const maps: Array<Readonly<Record<string, CostModelSpend>>> = [cost.perModel]
  for (const id of ids.slice(1)) {
    const childCost = byId[id]?.projectionValues?.sessionCost
    if (childCost !== undefined) maps.push(childCost.perModel)
  }
  return { merged: mergeSpend(maps), descendants: ids.length - 1 }
}

function CostPill({ cost, rollup, t, dialog }: {
  cost: SessionCostProjection
  /** Per-model spend merged over the viewed session and its descendants. */
  rollup: SpendRollup
  t: ChatViewSlotProps['t']
  dialog: PillDialog
}) {
  const seat = useStatDialog(dialog)
  const rate = perMillionMicros(cost.costMicros, spendTokens(cost))
  const costText = t('stats.cost', { amount: formatUsdMicros(cost.costMicros, t) })
  const rateText = rate !== null
    ? t('stats.costPerMillion', { amount: formatUsdMicros(rate, t) })
    : null
  // The prompt-side share of the fold's own buckets: the cache rate the
  // blended figure is priced under.
  const cacheHit = formatCacheHitPercent(
    cost.cacheReadTokens,
    cost.uncachedInputTokens + cost.cacheReadTokens + cost.cacheWriteTokens,
  )
  const segments = rateText === null ? [costText] : [costText, rateText]
  return (
    <span ref={seat.rootRef} className={css.anchor}>
      <StatPillButton seat={seat} segments={segments} icon={<IconDataOutline16 />}>
        {costText}
        {rateText !== null && (
          <>
            <span className={css.sep} aria-hidden>·</span>
            {rateText}
          </>
        )}
      </StatPillButton>
      <StatDialogPanel
        seat={seat}
        label={t('stats.dialog.costTitle')}
        icon={<IconDataOutline16 />}
        title={t('stats.dialog.costTitle')}
        titleValue={formatUsdMicros(cost.costMicros, t)}
      >
        <dl className={dialogCss.details} data-session-stats-cost>
          {rateText !== null && (
            <>
              <dt>{t('stats.dialog.perMillion')}</dt>
              <dd>{rateText}</dd>
            </>
          )}
          {cacheHit !== null && (
            <>
              <dt>{t('message.turnUsage.cacheHit')}</dt>
              <dd>{`${cacheHit}%`}</dd>
            </>
          )}
          {sortedSpendEntries(rollup.merged).map(([model, spend]) => (
            <Fragment key={model}>
              <dt className={dialogCss.route}>{model === '' ? t('stats.costModelUnknown') : model}</dt>
              <dd>{t('stats.costModelSpend', {
                amount: formatUsdMicros(spend.costMicros, t),
                tokens: formatTokens(spendTokens(spend), t),
              })}</dd>
            </Fragment>
          ))}
          {rollup.descendants > 0 && (
            <>
              <dt>{t('stats.dialog.subagents')}</dt>
              <dd>{rollup.descendants}</dd>
            </>
          )}
        </dl>
      </StatDialogPanel>
    </span>
  )
}

export const StatsPills = memo(function StatsPills({
  useChat, useProjection, useSessions, sessionId, t,
}: StatsPillsProps) {
  const settledNodes = useChat(s => s.legacy.nodes)
  const usage = useProjection('tokenUsage')
  // Present exactly when the deployment declared rates and priced this log.
  const cost = useProjection('sessionCost')
  // List rows for the spend dialog's descendant rollup: subagent sessions
  // ride the list with their parentId and their own sessionCost value.
  const listRows = useSessions(s => s.byId)
  // One exclusive slot for the three dialogs: opening any pill closes the others.
  const [openPill, setOpenPill] = useState<'time' | 'usage' | 'cost' | null>(null)
  // Every figure rides the durable sessionStats projection, so paging and
  // compaction cannot change any of them; an assembly without the unit falls
  // back to the window-scoped fold wholesale (same field names), paid only
  // while no projection value is served.
  const projected = useProjection('sessionStats')
  const stats = useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes])
  // The current-speed reading always rides the loaded window: the durable
  // projection aggregates the whole log and carries no per-request figure.
  const lastTps = useMemo(() => lastRequestTps(settledNodes), [settledNodes])
  // Gated on actual token activity: a session whose steps all settled without
  // billing (e.g. every request failed) shows its counts without a usage pill.
  const hasTokens = usage !== undefined
    && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)
  if (stats.steps === 0 && !hasTokens) return null
  // data-composer-stats: InputBar's `.root:has([data-composer-stats])` rule
  // tightens the composer's bottom clearance only while this row renders.
  return (
    <div className={css.root} data-composer-stats>
      {stats.steps > 0 && (
        <TimePill
          stats={stats}
          lastTps={lastTps}
          t={t}
          dialog={{
            open: openPill === 'time',
            setOpen: (open) => { setOpenPill(open ? 'time' : null) },
          }}
        />
      )}
      {hasTokens && (
        <UsagePill
          usage={usage}
          t={t}
          dialog={{
            open: openPill === 'usage',
            setOpen: (open) => { setOpenPill(open ? 'usage' : null) },
          }}
        />
      )}
      {cost !== undefined && (
        <CostPill
          cost={cost}
          rollup={costRollup(cost, listRows, sessionId)}
          t={t}
          dialog={{
            open: openPill === 'cost',
            setOpen: (open) => { setOpenPill(open ? 'cost' : null) },
          }}
        />
      )}
    </div>
  )
})
