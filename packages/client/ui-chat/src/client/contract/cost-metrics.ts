// Cost metrics shared by the composer spend pill and the token
// efficiency window: both surfaces must print the same figures from one
// fold, so the blended rate, the per-model sort, and the cross-session
// reading/ordering folds ride this package's shared API instead of two
// copies.

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

/** The fold's own prompt-side buckets, kept for family pooling. */
export interface PromptBuckets {
  uncached: number
  cacheRead: number
  cacheWrite: number
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
  promptBuckets: PromptBuckets
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
    promptBuckets: {
      uncached: cost.uncachedInputTokens,
      cacheRead: cost.cacheReadTokens,
      cacheWrite: cost.cacheWriteTokens,
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
}

/** An efficiency reading annotated with its indent and family rollup. */
export interface IndentedReading extends EfficiencyReading {
  depth: number
  /** Set on ladder roots: the session's rollup over root plus subagents. */
  family: FamilyRollup | null
}

/** Rates descending, null rates last, title tiebreak. */
function byRate(leftRate: number | null, rightRate: number | null, leftTitle: string, rightTitle: string): number {
  return (rightRate ?? -1) - (leftRate ?? -1) || leftTitle.localeCompare(rightTitle)
}

interface RawRollup {
  micros: number
  tokens: number
  uncached: number
  cacheRead: number
  cacheWrite: number
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
  acc.perModel[model] = prior === undefined
    ? { ...spend }
    : {
      uncachedInputTokens: prior.uncachedInputTokens + spend.uncachedInputTokens,
      outputTokens: prior.outputTokens + spend.outputTokens,
      cacheReadTokens: prior.cacheReadTokens + spend.cacheReadTokens,
      cacheWriteTokens: prior.cacheWriteTokens + spend.cacheWriteTokens,
      costMicros: prior.costMicros + spend.costMicros,
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
  acc.uncached += reading.promptBuckets.uncached
  acc.cacheRead += reading.promptBuckets.cacheRead
  acc.cacheWrite += reading.promptBuckets.cacheWrite
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
  for (const [model, spend] of Object.entries(child.perModel)) addModelSpend(acc, model, spend)
}

/**
 * Order the priced readings roots-first, session-based: roots rank by their
 * family blended rate (the session pools its subagents), each root
 * followed depth-first by its descendant subtree whose rows detail their
 * own folds, depths annotating the indent. Every root carries its family
 * rollup — models, spend, rate, and cache hit over root plus subagents.
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
    const acc: RawRollup = { micros: 0, tokens: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, perModel: {} }
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
    }
  }
  const ordered: IndentedReading[] = []
  const visited = new Set<string>()
  const walk = (reading: EfficiencyReading, depth: number, isLadderRoot: boolean): void => {
    if (visited.has(reading.id)) return
    visited.add(reading.id)
    ordered.push({ ...reading, depth, family: isLadderRoot ? familyOf(reading) : null })
    const kids = (children.get(reading.id) ?? [])
      .toSorted((a, b) => byRate(a.rateMicros, b.rateMicros, a.title, b.title))
    for (const kid of kids) walk(kid, depth + 1, false)
  }
  for (const root of roots.toSorted((a, b) => byRate(familyOf(a).rate, familyOf(b).rate, a.title, b.title))) {
    walk(root, 0, true)
  }
  // A pure cycle has no root; append its members as roots in rate order.
  for (const reading of [...readings].sort((a, b) => byRate(a.rateMicros, b.rateMicros, a.title, b.title))) {
    if (!visited.has(reading.id)) walk(reading, 0, true)
  }
  return ordered
}

/** The rate a row displays: its family rollup on roots, its own fold below. */
export function displayedRate(row: IndentedReading): number | null {
  return row.family !== null ? row.family.rate : row.rateMicros
}

/** One model-count group's pooled micros and tokens plus the pooled rate. */
export interface PooledRate {
  micros: number
  tokens: number
  rate: number | null
  sessions: number
}

/**
 * Pool the ladder roots by session-family model count (1 vs 2+): family
 * micros and tokens summed per group and divided once — pooling is the
 * honest aggregate, never an average of per-session rates. A session sits
 * in the mixed group when its family — the root plus its subagent tree —
 * logged two or more models.
 * @param ordered - the ordered readings; roots carry their family rollup.
 * @returns each non-empty group's pool plus the priced root count.
 */
export function pooledRates(ordered: readonly IndentedReading[]): {
  single: PooledRate | null
  multi: PooledRate | null
  priced: number
} {
  const families = ordered.flatMap(row => row.family === null ? [] : [row.family])
  const pool = (members: readonly FamilyRollup[]): PooledRate => {
    const micros = members.reduce((sum, f) => sum + f.micros, 0)
    const tokens = members.reduce((sum, f) => sum + f.tokens, 0)
    return { micros, tokens, rate: perMillionMicros(micros, tokens), sessions: members.length }
  }
  const single = families.filter(f => f.models <= 1)
  const multi = families.filter(f => f.models >= 2)
  return {
    single: single.length > 0 ? pool(single) : null,
    multi: multi.length > 0 ? pool(multi) : null,
    priced: families.length,
  }
}
