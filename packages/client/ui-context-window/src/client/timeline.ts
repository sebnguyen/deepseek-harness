/**
 * Pure combining logic: walk the ordered per-node composition and the latest
 * Turn's real `cacheReadTokens` count to classify each node hit/partial/miss.
 *
 * KV-cache reuse is prefix-based — the provider reports one aggregate token
 * count from the start of the request, not per-block boundaries — so the cut
 * point is inferred by cumulative heuristic size, in surface order. This is
 * an estimate, same "approximate composition, never a total" caveat
 * token-meter's own `contextBreakdown` already documents; the node whose
 * range straddles the boundary is `'partial'`, not misattributed to one side.
 */
import type { ContextCompositionNode } from '@deepseek-ai/dsh-token-meter/client'

export type CacheClass = 'hit' | 'partial' | 'miss' | 'unknown'

export interface ContextWindowSegment extends ContextCompositionNode {
  readonly cacheClass: CacheClass
  /** Fraction of this node's own tokens estimated cached (0..1); meaningful only when `cacheClass === 'partial'`. */
  readonly hitFraction: number
}

/**
 * Classify ordered composition nodes against one real cache-read boundary.
 *
 * `cacheReadTokens` is `undefined` both before any usage settles and when
 * `deriveTurnTokenUsage`'s aggregate is genuinely indeterminate — a multi-step
 * Turn discloses the aggregate bucket only when *every* attempt reported it
 * (`aggregateAttempts` in `turn-usage.ts`), so one attempt whose provider
 * response omitted cache stats (e.g. a request that was later rate-limited)
 * blanks the whole Turn's `cacheReadTokens` even though another attempt in
 * the same Turn reported a real, nonzero read count. Treating that
 * indeterminate case as a confirmed zero boundary would render every segment
 * a false "miss"; `'unknown'` keeps that distinction visible instead.
 * @param nodes - ordered surface composition (`contextComposition` projection).
 * @param cacheReadTokens - the latest settled request's real cache-read count; `undefined` when no
 * usage has settled yet, or when the Turn's aggregate cache accounting is indeterminate.
 * @returns one classified segment per node, in the same order.
 */
export function classifyComposition(
  nodes: readonly ContextCompositionNode[],
  cacheReadTokens: number | undefined,
): readonly ContextWindowSegment[] {
  if (cacheReadTokens === undefined) {
    return nodes.map(node => ({ ...node, cacheClass: 'unknown', hitFraction: 0 }))
  }
  const boundary = cacheReadTokens
  let cumulative = 0
  return nodes.map((node) => {
    const start = cumulative
    cumulative += node.heuristicTokens
    if (node.heuristicTokens === 0) return { ...node, cacheClass: 'miss', hitFraction: 0 }
    if (cumulative <= boundary) return { ...node, cacheClass: 'hit', hitFraction: 1 }
    if (start >= boundary) return { ...node, cacheClass: 'miss', hitFraction: 0 }
    return { ...node, cacheClass: 'partial', hitFraction: (boundary - start) / node.heuristicTokens }
  })
}

/** Sum of every node's heuristic token price. */
export function totalHeuristicTokens(nodes: readonly { heuristicTokens: number }[]): number {
  return nodes.reduce((sum, node) => sum + node.heuristicTokens, 0)
}

/**
 * Real cache-hit percentage of the latest request's prompt, mirroring
 * `ui-chat`'s `formatCacheHitPercent` formula (cache reads over total prompt
 * tokens, i.e. total minus output) so the same request reads the same
 * percentage in both places.
 * @param cacheReadTokens - real cache-read count, when the provider reported one.
 * @param totalTokens - the turn's exact aggregate total.
 * @param outputTokens - the turn's exact output total.
 * @returns rounded percent, or `undefined` when prompt size is unknown or zero.
 */
export function cacheHitPercent(
  cacheReadTokens: number | undefined,
  totalTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  if (cacheReadTokens === undefined || totalTokens === undefined || outputTokens === undefined) return undefined
  const promptTokens = totalTokens - outputTokens
  if (promptTokens <= 0) return undefined
  return Math.round(cacheReadTokens / promptTokens * 100)
}
