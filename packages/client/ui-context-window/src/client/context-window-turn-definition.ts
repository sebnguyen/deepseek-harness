/**
 * Per-Turn token-usage Definition for the Context Window tab. Mirrors
 * ui-chat's `turnTailDefinition` matching exactly the event set
 * `deriveTurnTokenUsage` reads (turn/step boundaries, retries, assistant
 * settlement) — no chat-anchor or transcript logic, since this Definition
 * only needs the turn's real provider usage, not where to render a footer.
 */
import type {
  ConversationMatch, ConversationNodeDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import type { TurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import type { Context } from '@deepseek-ai/cordis'

/** One Turn's settled token usage, as published to the `context-window` target. */
export interface ContextWindowTurnUsage {
  readonly turn: number
  readonly usage: TurnTokenUsage | undefined
}

interface ContextWindowTurnState {
  readonly turn: number
}

function isSessionEvent(event: ConversationMatch['event']): event is SessionEvent {
  return event.type !== 'assistant/live-chunk'
}

/** Event types {@link deriveTurnTokenUsage} reads; everything else is irrelevant to this Definition. */
function turnOf(event: Parameters<ConversationNodeDefinition['match']>[0]): number | undefined {
  if (
    event.type === 'assistant/message'
    || event.type === 'assistant/attempt'
    || event.type === 'step/start'
    || event.type === 'step/end'
  ) return event.data.turn
  if (event.type === 'llm/retry' || event.type === 'llm/retry-started') return event.data.turn
  return undefined
}

const contextWindowTurnDefinition: ConversationNodeDefinition<ContextWindowTurnState> = {
  kind: 'context-window-turn',
  target: 'context-window',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'turn/end') return { id: String(event.data.turn), role: 'update' }
    const turn = turnOf(event)
    return turn === undefined ? null : { id: String(turn), role: 'update' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') {
      throw new Error('context-window-turn start requires turn/start')
    }
    return { turn: match.event.data.turn }
  },
  update: context => context.state,
  // Usage only settles at assistant/message (or a closing turn/end); no
  // reason to re-render on every intermediate step/retry boundary.
  publication: match => (match.event.type === 'assistant/message' || match.event.type === 'turn/end')
    ? 'immediate'
    : 'none',
  buildViewNode: (context): ConversationViewNode | null => {
    if (context.state === undefined) return null
    const events = context.matches.map(match => match.event).filter(isSessionEvent)
    const usage = deriveTurnTokenUsage(events)
    const data: ContextWindowTurnUsage = { turn: context.state.turn, usage }
    return { key: context.key, kind: 'context-window-turn', id: context.id, target: 'context-window', data }
  },
}

/**
 * Register the per-Turn usage Definition feeding the Context Window tab.
 * @param ctx - owning client Context.
 */
export function registerContextWindowTurnDefinition(ctx: Context): void {
  ctx.uiConversation.events.register(contextWindowTurnDefinition)
}
