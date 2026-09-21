/**
 * Raw-surface capture for the Trajectory Context tab: an independent
 * Definition retaining each `system/message`/`user/message`/
 * `assistant/message`/`tool/result`/`request/header`/`request/context` event
 * verbatim, keyed by seq, so `trajectory-composition.ts` can fold any
 * request's exact composition (and its model context-window capacity) on
 * demand. Deliberately a separate target from `'trajectory'`
 * — that target's builder (`trajectory-snapshot-builder.ts`) interprets
 * these same events into `TrajectoryContribution`s for the ledger's own
 * display model, which does not retain the raw `SessionEvent` shape
 * `planSurfaceTokens`/`commitSurfaceTokens` need; capturing it independently
 * here does not touch that existing, delicate state machine.
 *
 * @module ui-trajectory/trajectory-composition-definition
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition, ConversationViewBuilder, ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    'trajectory-composition': TrajectoryRawSurfaceSnapshot
  }
}

/** Raw surface/header events captured so far, keyed by seq, unordered. */
export interface TrajectoryRawSurfaceSnapshot {
  readonly events: ReadonlyMap<number, SessionEvent>
}

/** Selector hook over the current Conversation binding's raw-surface capture target. */
export type UseTrajectoryComposition = SnapshotSelectorHook<TrajectoryRawSurfaceSnapshot>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** Selector hook over the current Conversation binding's raw-surface capture target. */
    useTrajectoryComposition: UseTrajectoryComposition
  }
}

export const EMPTY_RAW_SURFACE_SNAPSHOT: TrajectoryRawSurfaceSnapshot = { events: new Map() }

interface RawSurfaceState {
  readonly event: SessionEvent
}

const trajectoryRawSurfaceDefinition: ConversationNodeDefinition<RawSurfaceState> = {
  kind: 'trajectory-composition-raw-surface',
  target: 'trajectory-composition',
  match: (event) => {
    if (
      event.type === 'system/message'
      || event.type === 'user/message'
      || event.type === 'assistant/message'
      || event.type === 'tool/result'
      || event.type === 'request/header'
      || event.type === 'request/context'
    ) return { id: String(event.seq), role: 'start' }
    return null
  },
  start: (_context, match) => ({ event: match.event }),
  // One-shot: the same seq's raw event never changes once logged.
  update: context => context.state,
  buildViewNode: (context): ConversationViewNode | null => context.state === undefined ? null : {
    key: context.key,
    kind: 'trajectory-composition-raw-surface',
    id: context.id,
    target: 'trajectory-composition',
    data: context.state.event,
  },
}

function isSessionEvent(data: unknown): data is SessionEvent {
  return typeof data === 'object' && data !== null && 'seq' in data && 'type' in data
}

function createTrajectoryCompositionViewBuilder(): ConversationViewBuilder<ConversationViewNode, TrajectoryRawSurfaceSnapshot> {
  const eventsByKey = new Map<string, SessionEvent>()
  const derive = (): TrajectoryRawSurfaceSnapshot => {
    const events = new Map<number, SessionEvent>()
    for (const event of eventsByKey.values()) events.set(event.seq, event)
    return { events }
  }
  return {
    empty: EMPTY_RAW_SURFACE_SNAPSHOT,
    // Monotonic capture: a logged seq never changes, and compaction folds need
    // every raw surface event ever delivered — not only the nodes in the latest
    // view replace (which mirrors the current window, not the full event log).
    replace: ({ nodes }) => {
      for (const node of nodes) if (isSessionEvent(node.data)) eventsByKey.set(node.key, node.data)
      return derive()
    },
    apply: ({ upserts }) => {
      for (const node of upserts) if (isSessionEvent(node.data)) eventsByKey.set(node.key, node.data)
      return derive()
    },
  }
}

const trajectoryCompositionViewDefinition: ConversationViewDefinition<ConversationViewNode, TrajectoryRawSurfaceSnapshot> = {
  target: 'trajectory-composition',
  create: createTrajectoryCompositionViewBuilder,
  isActive: snapshot => snapshot.events.size > 0,
}

/**
 * Register the raw-surface capture Definition and its view target.
 * @param ctx - owning client Context.
 */
export function registerTrajectoryCompositionDefinition(ctx: Context): void {
  ctx.uiConversation.events.register(trajectoryRawSurfaceDefinition)
  ctx.uiConversation.views.register(trajectoryCompositionViewDefinition)
}
