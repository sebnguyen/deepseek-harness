/**
 * Client-side reconstruction of one specific request's exact prompt
 * composition, colored by real KV-cache hit/miss. `token-meter`'s own
 * `contextComposition`/`contextBreakdown` projections only ever expose the
 * *current* retained surface — correct for "what is in context right now,"
 * wrong for "what did request N actually see," since a later request's
 * tool calls and replies are not yet part of the surface a past request's
 * prompt was built from. Any request's exact composition is nonetheless
 * always reconstructable, per the "model-visible ⟺ logged" invariant: fold
 * `planSurfaceTokens`/`commitSurfaceTokens` (the same primitives
 * `contextComposition` folds server-side) over the raw surface events up to
 * and including that request's own boundary seq, entirely in the browser,
 * using whichever raw events the Trajectory ledger has already captured.
 *
 * @module ui-trajectory/trajectory-composition
 */

import { isSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import {
  commitSurfaceTokens, estimateToolsTokens, planSurfaceTokens,
} from '@deepseek-ai/dsh-token-meter/client'

/** One priced surface node, plus the role its source event derives from. */
export interface CompositionNode {
  readonly seq: number
  readonly role: 'system' | 'user' | 'assistant' | 'tool' | 'tools'
  readonly heuristicTokens: number
}

/**
 * A composition node as folded (branded seq, matching `planSurfaceTokens`'s `MeterSurfaceNode`
 * shape); de-branded to plain `number` at the module boundary, matching Trajectory's own
 * `TrajectoryRequestNumber.seq` convention.
 */
interface FoldedNode {
  readonly seq: ReturnType<typeof SessionSeq>
  readonly role: CompositionNode['role']
  readonly heuristicTokens: number
}

/** The four surface-event types a composition node can derive its role from. */
const SURFACE_ROLE: Record<'system/message' | 'user/message' | 'assistant/message' | 'tool/result', CompositionNode['role']> = {
  'system/message': 'system',
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'tool',
}

/**
 * Fold every raw surface event up to and including `boundarySeq` into the
 * ordered composition a request anchored there was built from, plus a
 * synthetic `'tools'` node for the tool schemas in force at that point
 * (priced from the latest `request/header` at or before the boundary,
 * exactly as `contextBreakdown`'s `toolsTokens` bucket is server-side).
 * @param events - raw events the Trajectory ledger has captured, in any order (sorted here by seq).
 * @param boundarySeq - the anchor seq of the request being inspected; later events are excluded.
 * @returns the ordered composition as of that request, oldest first.
 */
/**
 * Like {@link foldCompositionUpTo}, but returns `undefined` when the captured
 * events are not yet complete enough to replay the surface (missing seqs
 * referenced by a compaction replace) instead of throwing.
 */
export function tryFoldCompositionUpTo(
  events: readonly SessionEvent[],
  boundarySeq: number,
): readonly CompositionNode[] | undefined {
  try {
    return foldCompositionUpTo(events, boundarySeq)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('token surface:')) return undefined
    throw error
  }
}

/**
 * Lowest session seq the event window must cover before
 * {@link tryFoldCompositionUpTo} can reconstruct `boundarySeq`'s exact
 * composition. Always the session start (`0`): the fold rebuilds the surface
 * from its head node (the leading `system/message`), whose seq an already
 * partial capture cannot name, and every replace-source seq is at or after
 * that head, so paging to the start covers both.
 */
export function compositionBackfillThroughSeq(
  _events: readonly SessionEvent[],
  _boundarySeq: number,
): number {
  return 0
}

export function foldCompositionUpTo(
  events: readonly SessionEvent[],
  boundarySeq: number,
): readonly CompositionNode[] {
  const ordered = events.filter(event => event.seq <= boundarySeq).sort((a, b) => a.seq - b.seq)
  let nodes: FoldedNode[] = []
  let toolsTokens = 0
  let toolsSeq: ReturnType<typeof SessionSeq> | undefined
  for (const event of ordered) {
    if (event.type === 'request/header') {
      toolsTokens = estimateToolsTokens(event.data.header)
      toolsSeq = toolsTokens === 0 ? undefined : event.seq
      continue
    }
    if (!isSurfaceEvent(event)) continue
    const plan = planSurfaceTokens(nodes, event)
    const next = [...nodes]
    commitSurfaceTokens(next, {
      ...plan,
      node: { seq: event.seq, heuristicTokens: plan.tokens, role: SURFACE_ROLE[event.type] },
    })
    nodes = next
  }
  const roled: CompositionNode[] = nodes.map(node => ({ seq: Number(node.seq), role: node.role, heuristicTokens: node.heuristicTokens }))
  if (toolsSeq === undefined) return roled
  const systemIdx = roled.findLastIndex(node => node.role === 'system' && node.heuristicTokens > 0)
  const insertAt = systemIdx === -1 ? 0 : systemIdx + 1
  const toolsNode: CompositionNode = { seq: Number(toolsSeq), role: 'tools', heuristicTokens: toolsTokens }
  return [...roled.slice(0, insertAt), toolsNode, ...roled.slice(insertAt)]
}

export type CacheClass = 'hit' | 'partial' | 'miss' | 'unknown'

export interface CompositionSegment extends CompositionNode {
  readonly cacheClass: CacheClass
  /** Fraction of this node's own tokens estimated cached (0..1); meaningful only when `cacheClass === 'partial'`. */
  readonly hitFraction: number
}

/**
 * Classify ordered composition nodes against one real cache-read boundary.
 * `cacheReadTokens` is `undefined` when the request's own usage sample never
 * reported it — treated as indeterminate, not a confirmed-zero boundary, so
 * an unreported read count does not paint every segment a false miss.
 * @param nodes - ordered composition, oldest first.
 * @param cacheReadTokens - the request's own real cache-read count, when known.
 * @returns one classified segment per node, in the same order.
 */
export function classifyComposition(
  nodes: readonly CompositionNode[],
  cacheReadTokens: number | undefined,
): readonly CompositionSegment[] {
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

/** Render one content block as plain text; unknown block types fall through to a bracketed tag. */
function blockText(block: ContentBlock): string {
  switch (block.type) {
    case 'text': return block.text
    case 'reasoning': return block.text
    case 'tool-call': return `${block.name}(${block.arguments})`
    case 'tool-result': return block.content.map(blockText).join('\n')
    case 'image': return '[image]'
    case 'file': return '[file]'
    default: return `[${(block as { type: string }).type}]`
  }
}

/** Render the current request envelope's full tool schemas, one per definition, name/description plus its exact JSON Schema. */
function describeToolSchemas(event: SessionEvent<'request/header'>): string {
  const tools = event.data.header.tools ?? []
  if (tools.length === 0) return ''
  return tools.map(tool =>
    `${tool.name}: ${tool.description}\n${JSON.stringify(tool.parameters, null, 2)}`).join('\n\n')
}

/**
 * Extract a plain-text preview from one raw surface event's exact message
 * content, or (for `request/header`) the request envelope's full tool
 * schemas at that point.
 * @param event - a `system/message`, `user/message`, `assistant/message`, `tool/result`, or `request/header` event.
 * @returns the joined block text, or `''` for an event type this function does not describe.
 */
export function describeEventContent(event: SessionEvent): string {
  switch (event.type) {
    case 'system/message': return event.data.message.content.map(blockText).join('\n\n')
    case 'user/message': return event.data.content.map(blockText).join('\n\n')
    case 'assistant/message': return event.data.message.content.map(blockText).join('\n\n')
    case 'tool/result': return event.data.message.content.map(blockText).join('\n\n')
    case 'request/header': return describeToolSchemas(event)
    default: return ''
  }
}
