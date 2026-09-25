/**
 * Request-wire capture for the Trajectory Context tab: one Definition retaining
 * each `request/wire` event verbatim, so the exact body an adapter dispatched
 * stays inspectable beside the request it belongs to.
 *
 * @module ui-trajectory/trajectory-wire-definition
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { trajectoryNode } from './trajectory-definition-common.ts'
import type { TrajectoryRequestWire } from './trajectory-contract.ts'

interface WireState extends TrajectoryRequestWire {}

const trajectoryWireDefinition: ConversationNodeDefinition<WireState> = {
  kind: 'trajectory-request-wire',
  target: 'trajectory',
  match: event => event.type === 'request/wire'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'request/wire') {
      throw new Error('trajectory-request-wire start requires request/wire')
    }
    const data = match.event.data
    return {
      seq: match.event.seq,
      time: match.event.time,
      provider: data.provider,
      model: data.model,
      ...(data.purpose === undefined ? {} : { purpose: data.purpose }),
      ...(data.representation === undefined ? {} : { representation: data.representation }),
      payload: data.payload,
    }
  },
  // One-shot: the same seq's body never changes once logged.
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : trajectoryNode(context, context.state.seq, { kind: 'request-wire', wire: context.state }),
}

/**
 * Register the Trajectory request-wire Definition.
 * @param ctx - Plugin context receiving the Definition.
 */
export function registerTrajectoryWireDefinition(ctx: Context): void {
  ctx.uiConversation.events.register(trajectoryWireDefinition)
}
