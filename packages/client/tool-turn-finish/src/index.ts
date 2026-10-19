/**
 * The `finish` tool: the voluntary early turn close quiet conversation mode
 * offers, registered in the ordinary tool catalog like every other model-facing
 * tool. Quiet promises a transcript whose closing row is one plain answer; the
 * model calls `finish` when the work is done and that closing answer is all the
 * turn has left. Under quiet, the call ends the turn at the tool result through
 * the registry's `concludeTurn` seam — the turn closes like any ordinary
 * completed turn, and conversation-mode's close latch queues the tagged
 * wrap-up turn that delivers the summary. Under any other shape — or where
 * conversation-mode is not composed — the call records nothing and the turn
 * continues untouched. Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-tool-turn-finish
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { } from '@deepseek-ai/dsh-agent'
import type { } from '@deepseek-ai/dsh-session'
import type { } from '@deepseek-ai/dsh-session-projection'
// Type-only: the `turnShape` projection key the execute guard reads is
// declared by conversation-mode; no runtime edge — a composition without
// conversation-mode simply folds to `recorded: false` on every call.
import type { } from '@deepseek-ai/dsh-client-conversation-mode'
import { z } from 'zod'

export const name = 'tool-turn-finish'
export const inject = ['tools', 'sessionProjections']

/** The finish tool takes no deployment configuration today. */
export interface TurnFinishConfig {}

/** Runtime schema for the empty {@link TurnFinishConfig}. */
export const Config = z.object({}).default({}) as unknown as z.ZodType<TurnFinishConfig>

const FINISH_DESCRIPTION =
  'Close the current turn early. Quiet conversation mode promises one plain closing answer, delivered '
  + 'through an automatic wrap-up request that fires right after the close — text emitted before that '
  + 'request is discarded, so call finish only when the work is done. '
  + 'Outside quiet conversation mode this call is inert and records nothing.'

/**
 * Register the `finish` tool on `ctx.tools`. The tool's execute reads the
 * calling session's `turnShape` projection at call time, so a mid-turn shape
 * flip rescues the close without any bookkeeping of its own.
 * @param ctx - registrant context carrying the tool and session-projection registries.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'finish',
    description: FINISH_DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          recorded: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.recorded
          ? 'Turn close recorded.'
          : 'No quiet turn shape is armed; the turn is unchanged.',
      }],
    },
    execute(_args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        // The close is per-agent-session state; a non-agent caller has nowhere
        // to clip. Reject rather than silently no-op.
        throw new Error('finish requires an owning agent session')
      }
      const shape = ctx.sessionProjections.stateOf(agent.session, 'turnShape')?.shape
      if (shape !== 'quiet') return Promise.resolve({ recorded: false })
      exec.concludeTurn()
      return Promise.resolve({ recorded: true })
    },
    presentCall: () => ({ card: 'generic', title: 'Close the turn', kind: 'other' }),
  }))
}
