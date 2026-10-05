// Cost metrics shared by the composer spend pill and the token-efficiency
// window: both surfaces must print the same figures from one fold, so the
// blended rate, the per-model sort, and the cross-session reading/ordering
// folds ride this package's shared API instead of two copies.

import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { CostModelSpend, SessionCostProjection } from '@deepseek-ai/dsh-session-stats/client'
import { formatCacheHitPercent } from './token-format.ts'

/**
 * Sum the four billed token buckets of one model's spend fold.
 * @param spend - one model's folded usage and spend.
 * @returns total billed tokens.
 */
export function spendTokens(spend: CostModelSpend): number {
  return spend.uncachedInputTokens + spend.outputTokens + spend.cacheReadTokens + spend.cacheWriteTokens
}

/**
 * The live blended spend per million billed tokens: folded micros spread
 * over the folded token total, so the current cache-hit share and the
 * uncached/cached input and output mix set the figure request by request.
 * @param costMicros - folded spend in USD micros.
 * @param totalTokens - folded billed tokens across all four buckets.
 * @returns USD micros per million tokens, or null with no billed tokens.
 */
export function perMillionMicros(costMicros: number, totalTokens: number): number | null {
  if (totalTokens === 0) return null
  return (costMicros / totalTokens) * 1_000_000
}

/**
 * Per-model spend entries most expensive first, micros ties by model id.
 * @param merged - merged per-model spend map.
 * @returns the sorted entries.
 */
export function sortedSpendEntries(merged: Record<string, CostModelSpend>): Array<[string, CostModelSpend]> {
  return Object.entries(merged)
    .sort(([leftModel, left], [rightModel, right]) => right.costMicros - left.costMicros
      || leftModel.localeCompare(rightModel))
}

/** One priced session pre-shaped for the efficiency table. */
export interface EfficiencyReading {
  id: string
  title: string
  parentId: string | null
  costMicros: number
  /** The fold's four billed buckets summed. */
  tokens: number
  /** Blended spend per million billed tokens; null when nothing billed. */
  rateMicros: number | null
  /** Display percent text of the fold's own prompt-side cache ratio. */
  cacheHit: string | null
  /** Non-empty logged model ids in the fold. */
  models: number
  /** Per-model spend rows, most expensive first. */
  spendEntries: ReadonlyArray<[string, CostModelSpend]>
}

/**
 * Project one sessions-list row's served `sessionCost` fold into an
 * efficiency reading.
 * @param id - the list row's session id.
 * @param row - the sessions-list row; title and parent come from it.
 * @param cost - the row's served sessionCost value.
 * @returns the reading.
 */
export function efficiencyReading(id: string, row: SessionSummary, cost: SessionCostProjection): EfficiencyReading {
  const spendEntries = sortedSpendEntries(cost.perModel)
  const promptTokens = cost.uncachedInputTokens + cost.cacheReadTokens + cost.cacheWriteTokens
  return {
    id,
    title: row.displayTitle,
    parentId: row.parentId ?? null,
    costMicros: cost.costMicros,
    tokens: spendTokens(cost),
    rateMicros: perMillionMicros(cost.costMicros, spendTokens(cost)),
    cacheHit: formatCacheHitPercent(cost.cacheReadTokens, promptTokens),
    models: spendEntries.filter(([, spend]) => spendTokens(spend) > 0).length,
    spendEntries,
  }
}

/** An efficiency reading annotated with its indent depth. */
export interface IndentedReading extends EfficiencyReading {
  depth: number
}

/** Readings by rate descending, null rates last, ties by title. */
function rateDesc(left: EfficiencyReading, right: EfficiencyReading): number {
  return (right.rateMicros ?? -1) - (left.rateMicros ?? -1) || left.title.localeCompare(right.title)
}

/**
 * Order the priced readings roots-first: roots by blended rate descending,
 * each root followed depth-first by its descendant subtree (subagent
 * sessions ride the list with their parentId), depths annotating the
 * indent. A parent chain that cycles or names an absent parent places its
 * orphaned rows as roots at the end instead of looping.
 * @param readings - one reading per priced sessions-list row.
 * @returns the display order with indent depths.
 */
export function orderEfficiencyReadings(readings: readonly EfficiencyReading[]): IndentedReading[] {
  const byId = new Map(readings.map(reading => [reading.id, reading]))
  const children = new Map<string, EfficiencyReading[]>()
  const roots: EfficiencyReading[] = []
  for (const reading of readings) {
    const parent = reading.parentId
    if (parent === null || !byId.has(parent)) roots.push(reading)
    else {
      const siblings = children.get(parent) ?? []
      siblings.push(reading)
      children.set(parent, siblings)
    }
  }
  const ordered: IndentedReading[] = []
  const visited = new Set<string>()
  const walk = (reading: EfficiencyReading, depth: number): void => {
    if (visited.has(reading.id)) return
    visited.add(reading.id)
    ordered.push({ ...reading, depth })
    const kids = (children.get(reading.id) ?? []).toSorted(rateDesc)
    for (const kid of kids) walk(kid, depth + 1)
  }
  for (const root of roots.toSorted(rateDesc)) walk(root, 0)
  // A pure cycle has no root; append its members as roots in rate order.
  for (const reading of [...readings].sort(rateDesc)) {
    if (!visited.has(reading.id)) walk(reading, 0)
  }
  return ordered
}

/** One model-count group's pooled micros and tokens plus the pooled rate. */
export interface PooledRate {
  micros: number
  tokens: number
  rate: number | null
  sessions: number
}

/**
 * Pool the readings by logged-model count (1 vs 2+): micros and tokens
 * summed per group and divided once — pooling is the honest aggregate,
 * never an average of per-session rates.
 * @param readings - the priced readings (parents and children alike).
 * @returns each non-empty group's pool plus the priced session count.
 */
export function pooledRates(readings: readonly EfficiencyReading[]): {
  single: PooledRate | null
  multi: PooledRate | null
  priced: number
} {
  const pool = (members: readonly EfficiencyReading[]): PooledRate => {
    const micros = members.reduce((sum, r) => sum + r.costMicros, 0)
    const tokens = members.reduce((sum, r) => sum + r.tokens, 0)
    return { micros, tokens, rate: perMillionMicros(micros, tokens), sessions: members.length }
  }
  const single = readings.filter(r => r.models <= 1)
  const multi = readings.filter(r => r.models >= 2)
  return {
    single: single.length > 0 ? pool(single) : null,
    multi: multi.length > 0 ? pool(multi) : null,
    priced: readings.length,
  }
}
