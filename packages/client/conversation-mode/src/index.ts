/**
 * Turn-shape conversation modes, host half.
 *
 * The shape promises a transcript property (narrate / quiet / tools), and
 * that promise is owned by the ui-chat render contract — never by request
 * grammar. The shape is session-scoped logged state: `session.setTurnShape`
 * and `/turn-shape` append one `turn-shape/mode` event per selection, and the
 * `turnShape` projection folds the log, so resume and fork restore the shape
 * and a selection made in one session never touches another. Model-side the
 * plugin stays deliberately small:
 *
 * - **The projection is snapshotted per turn.** The first admission of each
 *   turn (the step-1 pre-step, before any request is built) fixes the turn's
 *   shape from the folded state. A selection made mid-turn changes the logged
 *   state, never the open turn; the snapshot is keyed by (session, turn) so
 *   same-step retries and concurrent sessions keep the minted value.
 * - **A one-line reminder** injected into every turn of a non-narrate shape,
 *   stating the transcript promise in one sentence. This is the shape's only
 *   model-facing instruction.
 *
 * The request itself stays untouched in every shape: the retired strict
 * empty-object `structuredOutput` shield suppressed the provider's
 * reasoning channel alongside the leaked prose it guarded against, which
 * deleted the transcript's thoughts under quiet and tools. Thoughts now
 * render regardless of the armed shape, and the plugin attaches **no
 * grammar fields in any form** — no `structuredOutput`, no `toolChoice`.
 * Turn termination stays the loop's natural zero-tool-call rule.
 *
 * `narrate` performs no injection at all.
 *
 * Agent Note:
 * - .agents/notes/implemented/architecture/2026-10-12-turn-shape-session-scope.md
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import { turnShapeReminderText, type TurnShapeSource } from './turn-shape.ts'
import {
  DEFAULT_SHAPE, TURN_SHAPES, type TurnShape, type TurnShapeProjection, type TurnShapeUnitState,
} from './types.ts'

export type * from './types.ts'
export { turnShapeReminderText, type TurnShapeSource } from './turn-shape.ts'

const turnShapeUnitStateSchema = z.object({
  shape: z.enum(['narrate', 'quiet', 'tools']),
}) as unknown as z.ZodType<TurnShapeUnitState>

const turnShapeProjectionSchema = z.object({
  shape: z.enum(['narrate', 'quiet', 'tools']),
}) as unknown as z.ZodType<TurnShapeProjection>

/** Projection of the logged turn-shape selection; the last `turn-shape/mode` wins. */
export const turnShapeProjectionDefinition = {
  key: 'turnShape',
  stateVersion: 1,
  stateSchema: turnShapeUnitStateSchema,
  init: () => ({ shape: DEFAULT_SHAPE }),
  apply: (state, event) => {
    if (event.type !== 'turn-shape/mode') return state
    return state.shape === event.data.shape ? state : { shape: event.data.shape }
  },
  wire: {
    viewSchema: turnShapeProjectionSchema,
    view: state => ({ shape: state.shape }),
  },
} satisfies ProjectionDefinition<'turnShape', TurnShapeUnitState>

/** Host plugin body: the projection registration, the per-turn snapshot, and the per-turn reminder. */
export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (scoped) => {
    scoped.sessionProjections.register(turnShapeProjectionDefinition)

    /**
     * Per-session turn shape snapshot. Minted lazily at the first admission
     * of a (session, turn) pair — the step-1 pre-step of the turn, which
     * precedes its first request — so a mid-turn selection applies from the
     * next turn exactly, and same-step retries remint nothing. Bounded so
     * long-lived hosts never grow it without limit; a reclaimed snapshot
     * simply re-mints under the then-current projection state, which is
     * correct for any turn still open.
     */
    const snapshots = new Map<Agent, { turn: number; shape: TurnShape }>()
    const MAX_SNAPSHOTS = 64
    const shapeForTurn = (agent: Agent, turn: number): TurnShape => {
      const snapshot = snapshots.get(agent)
      if (snapshot !== undefined) {
        if (snapshot.turn === turn) return snapshot.shape
        snapshots.delete(agent)
      }
      const shape = scoped.sessionProjections.stateOf(agent.session, 'turnShape')?.shape ?? DEFAULT_SHAPE
      while (snapshots.size >= MAX_SNAPSHOTS) {
        const oldest = snapshots.keys().next()
        if (oldest.done === true) break
        snapshots.delete(oldest.value)
      }
      snapshots.set(agent, { turn, shape })
      return shape
    }

    // The per-turn reminder rides step-1 admission, mirroring the other
    // turn-context reminders (staging ladder, repeat-tool).
    scoped.on('agent/pre-step', async ({ agent, turn, step }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind !== 'enter' || step !== 1) return decision
      const shape = shapeForTurn(agent, turn)
      if (shape === 'narrate') return decision
      const reminderSource: TurnShapeSource = { kind: 'turn-shape', turnShape: shape }
      const reminder: UserMessage = createUserMessage({
        content: [{ type: 'text', text: turnShapeReminderText(shape) }],
        source: reminderSource,
      })
      return { ...decision, messages: [...decision.messages, reminder] }
    })

    // The command child activates only when a command registry is composed.
    scoped.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register({
        definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-client-conversation-mode'),
        name: 'turn-shape',
        description: "Set this session's turn shape",
        input: { hint: `<${TURN_SHAPES.join('|')}>` },
        handler: ({ agent, rawInput }) => {
          const input = rawInput.trim()
          const shape = TURN_SHAPES.find(candidate => candidate === input)
          if (shape === undefined) {
            return { kind: 'error', text: `Usage: /turn-shape <${TURN_SHAPES.join('|')}>.` }
          }
          const current = scoped.sessionProjections.stateOf(agent.session, 'turnShape')?.shape ?? DEFAULT_SHAPE
          if (shape === current) {
            return { kind: 'success', text: `Turn shape is already ${shape}.` }
          }
          agent.session.append('turn-shape/mode', { shape })
          return { kind: 'success', text: `Turn shape set to ${shape} — applies from the next turn.` }
        },
      })
    })
  })
}
