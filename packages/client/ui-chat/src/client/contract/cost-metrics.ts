// Cost metrics shared compositor for the spend pill and the token
// efficiency window: both surfaces must print the same figures from one
// fold, so the blended rate, the per-model sort, and the cross-session
// reading/ordering folds ride this package's shared API instead of two
// copies. The efficiency window's comparison columns divide every row's
// blended rate by three whole-table anchors — the median family rate,
// the pooled micros-over-tokens rate, and the maximum family rate — and
// its mix bar splits one fold's billed tokens over the four buckets the
// providers bill.

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

/** The four billed token buckets of one fold, in mix-bar order. */
export interface MixBuckets {
  uncached: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/**
 * Integer percents of one fold's billed total per bucket, rounded
 * independently for display; null when nothing billed so the row renders
 * an empty track instead of dividing by zero.
 * @param mix - the fold's four buckets.
 * @param totalTokens - their sum.
 * @returns [uncached, cacheRead, cacheWrite, output] percents, or null.
 */
export function mixPercents(mix: MixBuckets, totalTokens: number): [number, number, number, number] | null {
  if (totalTokens === 0) return null
  return [
    Math.round((mix.uncached / totalTokens) * 100),
    Math.round((mix.cacheRead / totalTokens) * 100),
    Math.round((mix.cacheWrite / totalTokens) * 100),
    Math.round((mix.output / totalTokens) * 100),
  ]
}

/**
 * Display precision for one rate-over-anchor multiple: whole above 10,
 * one decimal below, so the chips read ×0.3 / ×1.4 / ×11.
 * @param multiple - the raw rate quotient.
 * @returns the display digits without the × sign.
 */
export function formatMultiple(multiple: number): string {
  return multiple >= 10
    ? String(Math.round(multiple))
    : String(Math.round(multiple * 10) / 10)
}

/** The chip hue band for one multiple of an anchor. */
export type MultipleBand = 'good' | 'near' | 'high'

/**
 * Band one rate-over-anchor multiple: under 1 cheaper than the anchor,
 * under 2 near it, beyond pricier.
 * @param multiple - the raw rate quotient.
 * @returns the band the chip is colored by.
 */
export function multipleBand(multiple: number): MultipleBand {
  return multiple < 1 ? 'good' : multiple < 2 ? 'near' : 'high'
}

/** One priced session pre-shaped for the efficiency table. */
export interface EfficiencyReading {
  id: string
  title: string
  parentId: string | null
  /** Sessions-list recency stamp; roots and child ladders order by it, latest first. */
  updatedAt: number
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
  /** The fold's own billed buckets, in mix-bar order. */
  mix: MixBuckets
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
    updatedAt: row.updatedAt,
    costMicros: cost.costMicros,
    tokens: spendTokens(cost),
    rateMicros: perMillionMicros(cost.costMicros, spendTokens(cost)),
    cacheHit: formatCacheHitPercent(cost.cacheReadTokens, promptTokens),
    models: spendEntries.filter(([, spend]) => spendTokens(spend) > 0).length,
    spendEntries,
    mix: {
      uncached: cost.uncachedInputTokens,
      cacheRead: cost.cacheReadTokens,
      cacheWrite: cost.cacheWriteTokens,
      output: cost.outputTokens,
    },
  }
}

/** A root row's session-family rollup: its fold plus every subagent under it. */
export interface FamilyRollup {
  micros: number
  tokens: number
  rate: number | null
  /** Distinct logged models across the whole family. */
  models: number
  cacheHit: string | null
  /** Pooled per-model spend, most expensive first. */
  entries: ReadonlyArray<[string, CostModelSpend]>
  /** The family's billed buckets, in mix-bar order. */
  mix: MixBuckets
}

/** An efficiency reading annotated with its indent and family rollup. */
export interface IndentedReading extends EfficiencyReading {
  depth: number
  /** Set on ladder roots: the session's rollup over root plus subagents. */
  family: FamilyRollup | null
}

/** Most recently updated first, title tiebreak. */
function byLatest(leftTime: number, rightTime: number, leftTitle: string, rightTitle: string): number {
  return rightTime - leftTime || leftTitle.localeCompare(rightTitle)
}

interface RawRollup {
  micros: number
  tokens: number
  uncached: number
  cacheRead: number
  cacheWrite: number
  output: number
  perModel: Record<string, CostModelSpend>
}

/**
 * Fold one model's spend into a raw rollup's per-model map, adding bucket
 * totals onto an earlier entry for the same model.
 * @param acc - the rollup accumulating.
 * @param model - the logged model id.
 * @param spend - the model's folded usage and spend.
 */
function addModelSpend(acc: RawRollup, model: string, spend: CostModelSpend): void {
  const prior = acc.perModel[model]
  if (prior === undefined) acc.perModel[model] = { ...spend }
  else {
    acc.perModel[model] = {
      uncachedInputTokens: prior.uncachedInputTokens + spend.uncachedInputTokens,
      outputTokens: prior.outputTokens + spend.outputTokens,
      cacheReadTokens: prior.cacheReadTokens + spend.cacheReadTokens,
      cacheWriteTokens: prior.cacheWriteTokens + spend.cacheWriteTokens,
      costMicros: prior.costMicros + spend.costMicros,
    }
  }
}

/**
 * Add one fold's micros, buckets, and per-model map into a raw rollup.
 * @param acc - the rollup accumulating.
 * @param reading - the fold to add.
 */
function addToRollup(acc: RawRollup, reading: EfficiencyReading): void {
  acc.micros += reading.costMicros
  acc.tokens += reading.tokens
  acc.uncached += reading.mix.uncached
  acc.cacheRead += reading.mix.cacheRead
  acc.cacheWrite += reading.mix.cacheWrite
  acc.output += reading.mix.output
  for (const [model, spend] of reading.spendEntries) addModelSpend(acc, model, spend)
}

/**
 * Merge a child's raw rollup into its parent's.
 * @param acc - the parent rollup accumulating.
 * @param child - the child subtree's rollup.
 */
function mergeRollup(acc: RawRollup, child: RawRollup): void {
  acc.micros += child.micros
  acc.tokens += child.tokens
  acc.uncached += child.uncached
  acc.cacheRead += child.cacheRead
  acc.cacheWrite += child.cacheWrite
  acc.output += child.output
  for (const [model, spend] of Object.entries(child.perModel)) addModelSpend(acc, model, spend)
}

/**
 * Order the priced readings roots-first, session-based: roots rank
 * latest-updated first (the session pools its subagents), each root
 * followed depth-first by its descendant subtree, likewise latest-first,
 * whose rows detail their own folds; depths annotating the indent. Every root carries its family
 * rollup — models, spend, rate, mix, and cache hit over root plus subagents.
 * A parent chain that cycles or names an absent parent places its
 * orphaned rows as roots at the end instead of looping.
 * @param readings - one reading per priced sessions-list row.
 * @returns the display order with indent depths and family rollups.
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
  const rawRollups = new Map<string, RawRollup>()
  const rollupOf = (reading: EfficiencyReading): RawRollup => {
    const cached = rawRollups.get(reading.id)
    if (cached !== undefined) return cached
    // Prime the memo before folding children so a parent cycle re-enters
    // this function and cuts at the empty accumulator instead of looping.
    const acc: RawRollup = { micros: 0, tokens: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, perModel: {} }
    rawRollups.set(reading.id, acc)
    addToRollup(acc, reading)
    for (const kid of children.get(reading.id) ?? []) mergeRollup(acc, rollupOf(kid))
    return acc
  }
  const familyOf = (reading: EfficiencyReading): FamilyRollup => {
    const raw = rollupOf(reading)
    const entries = sortedSpendEntries(raw.perModel)
    const promptTokens = raw.uncached + raw.cacheRead + raw.cacheWrite
    return {
      micros: raw.micros,
      tokens: raw.tokens,
      rate: perMillionMicros(raw.micros, raw.tokens),
      models: entries.filter(([, spend]) => spendTokens(spend) > 0).length,
      cacheHit: formatCacheHitPercent(raw.cacheRead, promptTokens),
      entries,
      mix: { uncached: raw.uncached, cacheRead: raw.cacheRead, cacheWrite: raw.cacheWrite, output: raw.output },
    }
  }
  const ordered: IndentedReading[] = []
  const visited = new Set<string>()
  const walk = (reading: EfficiencyReading, depth: number, isLadderRoot: boolean): void => {
    if (visited.has(reading.id)) return
    visited.add(reading.id)
    ordered.push({ ...reading, depth, family: isLadderRoot ? familyOf(reading) : null })
    const kids = (children.get(reading.id) ?? [])
      .toSorted((a, b) => byLatest(a.updatedAt, b.updatedAt, a.title, b.title))
    for (const kid of kids) walk(kid, depth + 1, false)
  }
  for (const root of roots.toSorted((a, b) => byLatest(a.updatedAt, b.updatedAt, a.title, b.title))) {
    walk(root, 0, true)
  }
  // A pure cycle has no root; append its members as roots in latest order.
  for (const reading of [...readings].sort((a, b) => byLatest(a.updatedAt, b.updatedAt, a.title, b.title))) {
    if (!visited.has(reading.id)) walk(reading, 0, true)
  }
  return ordered
}

/** The pooled micros and tokens plus the pooled rate. */
export interface PooledRate {
  micros: number
  tokens: number
  rate: number | null
  sessions: number
}

/** The whole-table anchors the comparison chips divide against. */
export interface EfficiencyAnchors {
  /** Every priced session's family pooled as one, divided once. */
  average: PooledRate | null
  /** The middle root-family rate; the mean of the middle two on an even count. */
  median: number | null
  /** The highest root-family rate; that row's max chip reads ×1. */
  max: number | null
  /** Priced root count. */
  priced: number
}

/**
 * Read one index of the sorted family rate list; callers index inside
 * the non-empty guard above, so the fallback never runs.
 * @param rates - sorted non-empty root family rates.
 * @param index - position to read.
 * @returns the rate at that position.
 */
function ratedAt(rates: number[], index: number): number {
  /* v8 ignore next -- ?? arm: every call indexes inside the non-empty rates guard. */
  return rates[index] ?? 0
}

/**
 * Anchor the table on three whole-table figures over the root families:
 * the pooled micros over tokens (the money average), the median family
 * rate (one expensive session cannot drag it), and the maximum family
 * rate (the worst chat, against which every other row reads as headroom).
 * @param ordered - the ordered readings; roots carry their family rollup.
 * @returns the anchors and the priced root count.
 */
export function efficiencyAnchors(ordered: readonly IndentedReading[]): EfficiencyAnchors {
  const families = ordered.flatMap(row => row.family === null ? [] : [row.family])
  const micros = families.reduce((sum, f) => sum + f.micros, 0)
  const tokens = families.reduce((sum, f) => sum + f.tokens, 0)
  if (families.length === 0) return { average: null, median: null, max: null, priced: 0 }
  const rates = families.flatMap(f => f.rate === null ? [] : [f.rate]).sort((a, b) => a - b)
  const mid = Math.floor(rates.length / 2)
  const upper = ratedAt(rates, mid)
  const lower = rates.length % 2 === 1 ? upper : ratedAt(rates, mid - 1)
  return {
    average: { micros, tokens, rate: perMillionMicros(micros, tokens), sessions: families.length },
    median: rates.length % 2 === 1 ? upper : (lower + upper) / 2,
    max: ratedAt(rates, rates.length - 1),
    priced: families.length,
  }
}
