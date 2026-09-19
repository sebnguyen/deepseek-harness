/**
 * Ordered heuristic composition of the current retained surface, one entry
 * per surface node with its role and heuristic token price, plus a synthetic
 * `'tools'` entry for the current request envelope's tool schemas. Sibling of
 * {@link contextBreakdownProjectionDefinition} (same fold primitives, same
 * package) — that projection aggregates the identical per-node fold (and the
 * same `request/header` tools price) down to three buckets before it reaches
 * the wire; this one ships the ordered list itself, for consumers that need
 * per-primitive detail (e.g. a context-window composition view) rather than
 * a system/tools/messages summary.
 */

import { z } from 'zod'
import { canonicalHeader, isSurfaceEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEventType } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { estimateToolsTokens } from './estimate.ts'
import { commitSurfaceTokens, planSurfaceTokens } from './surface-fold.ts'
// Import for the `contextComposition` SessionProjectionStateMap key merge.
import type {} from './projection.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    contextComposition: ContextCompositionState
  }
}

const tokenCount = z.number().int().nonnegative()
const sessionSeq = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).transform(SessionSeq)

/** The four surface-event types a composition node can derive its role from. */
const SURFACE_ROLE: Record<Extract<SessionEventType, 'system/message' | 'user/message' | 'assistant/message' | 'tool/result'>, 'system' | 'user' | 'assistant' | 'tool'> = {
  'system/message': 'system',
  'user/message': 'user',
  'assistant/message': 'assistant',
  'tool/result': 'tool',
}

/** One surface node as retained internally — never `'tools'`: kept out of the
 * array `planSurfaceTokens`/`commitSurfaceTokens` splice by array index, so a
 * compaction replace range can never accidentally evict the synthetic tools
 * entry it was never told about. */
const surfaceNodeSchema = z.object({
  seq: sessionSeq,
  role: z.union([z.literal('system'), z.literal('user'), z.literal('assistant'), z.literal('tool')]),
  heuristicTokens: tokenCount,
}).strict()

/** Wire-facing node schema: the wider role union the tools entry adds at view time. */
const compositionNodeSchema = z.object({
  seq: sessionSeq,
  role: z.union([z.literal('system'), z.literal('user'), z.literal('assistant'), z.literal('tool'), z.literal('tools')]),
  heuristicTokens: tokenCount,
}).strict()

/** Plain-JSON checkpoint: retained surface positions, plus the current tools price and its owning event seq. */
const contextCompositionStateSchema = z.object({
  nodes: z.array(surfaceNodeSchema),
  toolsTokens: tokenCount,
  /** The `request/header` event that set the current `toolsTokens`; `null` while it's 0 (no synthetic entry to show). */
  toolsSeq: sessionSeq.nullable(),
}).strict()
type ContextCompositionState = z.infer<typeof contextCompositionStateSchema>

/**
 * Ordered surface composition, one node per retained surface position with
 * its role and heuristic token price. Replacements use the measurement
 * planner, not shadow-price claims, so state and surface transitions cost
 * O(current retained surface), not O(log length) — identical cost profile to
 * {@link contextBreakdownProjectionDefinition}, which this fold mirrors.
 *
 * Tools are priced from the latest request header exactly like
 * {@link contextBreakdownProjectionDefinition}'s `toolsTokens` bucket, but
 * inserted as an ordered node only at wire-view time — never into the
 * internal `nodes` array `commitSurfaceTokens` splices by array index — so a
 * surface replacement's index range, computed from real surface seqs only,
 * can never accidentally include or evict it.
 */
export const contextCompositionProjectionDefinition = {
  key: 'contextComposition',
  stateVersion: 2,
  stateSchema: contextCompositionStateSchema,
  init: (): ContextCompositionState => ({ nodes: [], toolsTokens: 0, toolsSeq: null }),
  apply: (state, event) => {
    if (event.type === 'request/header') {
      const toolsTokens = estimateToolsTokens(canonicalHeader(event.data.header))
      if (toolsTokens === state.toolsTokens) return state
      return { ...state, toolsTokens, toolsSeq: toolsTokens === 0 ? null : event.seq }
    }
    if (!isSurfaceEvent(event)) return state
    const plan = planSurfaceTokens(state.nodes, event)
    const nodes = [...state.nodes]
    commitSurfaceTokens(nodes, {
      ...plan,
      node: { seq: event.seq, heuristicTokens: plan.tokens, role: SURFACE_ROLE[event.type] },
    })
    return { ...state, nodes }
  },
  wire: {
    viewSchema: z.array(compositionNodeSchema),
    view: (state) => {
      if (state.toolsSeq === null) return state.nodes
      const systemIdx = state.nodes.findLastIndex(node => node.role === 'system' && node.heuristicTokens > 0)
      const insertAt = systemIdx === -1 ? 0 : systemIdx + 1
      const toolsNode = { seq: state.toolsSeq, role: 'tools' as const, heuristicTokens: state.toolsTokens }
      return [...state.nodes.slice(0, insertAt), toolsNode, ...state.nodes.slice(insertAt)]
    },
  },
} satisfies ProjectionDefinition<'contextComposition', ContextCompositionState>
