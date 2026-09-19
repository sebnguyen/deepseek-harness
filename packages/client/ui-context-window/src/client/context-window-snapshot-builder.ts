/**
 * Per-Session incremental builder for the `context-window` view target.
 * Folds two independent Definitions' nodes into one snapshot:
 * `context-window-turn` (per-Turn settled usage) and `context-window-content`
 * (per-event text preview, keyed by seq). `deriveTurnTokenUsage` only
 * discloses usage once a Turn reaches `turn/end` (an open or
 * aborted-mid-step Turn is unprovable by design), so `latest` deliberately
 * falls back past an in-flight or aborted newest Turn to the last one that
 * actually settled, rather than showing an empty state while a real settled
 * context still exists.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationViewBuilder, ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextWindowContentPreview } from './content-preview.ts'
import type { ContextWindowTurnUsage } from './context-window-turn-definition.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    'context-window': ContextWindowSnapshot
  }
}

/** Selector hook over the current Conversation binding's `context-window` target. */
export type UseContextWindow = SnapshotSelectorHook<ContextWindowSnapshot>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** Selector hook over the current Conversation binding's `context-window` target. */
    useContextWindow: UseContextWindow
  }
}

/** The Context Window tab's complete read model. */
export interface ContextWindowSnapshot {
  /** The last Turn that actually settled (has provable usage), if any. */
  readonly latest: ContextWindowTurnUsage | undefined
  /**
   * The highest Turn number seen at all, settled or not. Differs from
   * `latest.turn` exactly when the newest Turn is still open or was aborted
   * before disclosure could be proven.
   */
  readonly newestTurn: number | undefined
  /** Text preview per surface event, keyed by durable seq, for click-to-expand cards. */
  readonly contentBySeq: ReadonlyMap<number, string>
}

export const EMPTY_CONTEXT_WINDOW_SNAPSHOT: ContextWindowSnapshot = {
  latest: undefined,
  newestTurn: undefined,
  contentBySeq: new Map(),
}

function isTurnUsageData(data: unknown): data is ContextWindowTurnUsage {
  return typeof data === 'object' && data !== null && 'turn' in data && 'usage' in data
}

function isContentPreviewData(data: unknown): data is ContextWindowContentPreview {
  return typeof data === 'object' && data !== null && 'seq' in data && 'text' in data
}

function deriveSnapshot(nodes: Iterable<ConversationViewNode>): ContextWindowSnapshot {
  let latest: ContextWindowTurnUsage | undefined
  let newestTurn: number | undefined
  const contentBySeq = new Map<number, string>()
  for (const node of nodes) {
    if (isContentPreviewData(node.data)) {
      contentBySeq.set(node.data.seq, node.data.text)
      continue
    }
    if (!isTurnUsageData(node.data)) continue
    if (newestTurn === undefined || node.data.turn >= newestTurn) newestTurn = node.data.turn
    if (node.data.usage === undefined) continue
    if (latest === undefined || node.data.turn >= latest.turn) latest = node.data
  }
  return { latest, newestTurn, contentBySeq }
}

function createContextWindowViewBuilder(): ConversationViewBuilder<ConversationViewNode, ContextWindowSnapshot> {
  // Keyed by the engine's namespaced `key`, not the Definition-local `id` —
  // context-window-turn ids are turn numbers and context-window-content ids
  // are seqs, and those two integer spaces can collide on raw `id` alone.
  const nodesByKey = new Map<string, ConversationViewNode>()
  return {
    empty: EMPTY_CONTEXT_WINDOW_SNAPSHOT,
    replace: ({ nodes }) => {
      nodesByKey.clear()
      for (const node of nodes) nodesByKey.set(node.key, node)
      return deriveSnapshot(nodesByKey.values())
    },
    apply: ({ upserts }) => {
      for (const node of upserts) nodesByKey.set(node.key, node)
      return deriveSnapshot(nodesByKey.values())
    },
  }
}

const contextWindowViewDefinition: ConversationViewDefinition<ConversationViewNode, ContextWindowSnapshot> = {
  target: 'context-window',
  create: createContextWindowViewBuilder,
  isActive: snapshot => snapshot.latest !== undefined,
}

/**
 * Register the `context-window` view target.
 * @param ctx - owning client Context.
 */
export function registerContextWindowConversationView(ctx: Context): void {
  ctx.uiConversation.views.register(contextWindowViewDefinition)
}
