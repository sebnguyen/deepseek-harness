/**
 * Turn-shape conversation modes, host half.
 *
 * The shape promises a transcript property (narrate / quiet), and that promise
 * is owned by the ui-chat render contract — never by request grammar. The
 * shape is session-scoped logged state: `session.setTurnShape` and
 * `/turn-shape` append one `turn-shape/mode` event per selection, and the
 * `turnShape` projection folds the log, so resume and fork restore the shape
 * and a selection made in one session never touches another. Model-side the
 * plugin stays deliberately small:
 *
 * - **The projection is snapshotted per step admission.** The snapshot is
 *   minted at a step's admission — the loop's atomic commit point — so a
 *   mid-turn selection applies from the next step boundary exactly, and one
 *   step's retry cascade (all its (turn, step) dispatches) shares one
 *   contract. A selection made mid-turn changes the logged state and lands
 *   at the next admission; the snapshot is keyed by (session, turn, step) so
 *   retries never remint.
 * - **A one-line reminder** per shape epoch, injected at the first step
 *   admission that resolves under it — step 1 for a shape armed before the
 *   turn, the very next step for a mid-turn pick. Turn rollover remints,
 *   narrate erases the epoch, so re-entering a shaped epoch re-notifies
 *   exactly once. The reminder is the only model-facing hint; quiet is a
 *   render filter, not a generation constraint.
 *
 * `narrate` performs no injection at all.
 *
 * Agent Notes:
 * - .agents/notes/proposed/simplification/2026-10-21-turn-shape-two-modes-render-filter.md
 * - .agents/notes/implemented/architecture/2026-10-12-turn-shape-session-scope.md
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { } from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { turnShapeReminderText, type TurnShapeSource } from './turn-shape.ts'
import {
  DEFAULT_SHAPE, TURN_SHAPES, type TurnShape, type TurnShapeProjection, type TurnShapeUnitState,
} from './types.ts'

export type * from './types.ts'
export { turnShapeReminderText, type TurnShapeSource } from './turn-shape.ts'

/** Conversation-mode configuration accepted from cordis.yml `config:`. */
export interface ConversationModeConfig {}

/**
 * Runtime schema for {@link ConversationModeConfig}.
 * A cordis.yml row with no `config` arrives as `undefined` and validates as `{}`.
 */
export const Config = z.object({}).default({}) as unknown as z.ZodType<ConversationModeConfig>

const turnShapeUnitStateSchema = z.object({
  shape: z.enum(['narrate', 'quiet']),
}) as unknown as z.ZodType<TurnShapeUnitState>

const turnShapeProjectionSchema = z.object({
  shape: z.enum(['narrate', 'quiet']),
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

/**
 * Host plugin body: the projection registration, the per-step snapshot, and
 * the epoch reminder. No grammar hints, no wrap-up latch.
 * @param ctx - the plugin scope.
 * @param config - validated cordis.yml config.
 */
export function apply(ctx: Context, _config: ConversationModeConfig = {}): void {
  ctx.inject(['sessionProjections'], (scoped) => {
    scoped.sessionProjections.register(turnShapeProjectionDefinition)

    /**
     * Per-session turn shape snapshot. Minted at a step's admission — the
     * loop's atomic commit point — so a mid-turn selection applies from the
     * next step boundary exactly, and one step's retry cascade (all its
     * (turn, step) dispatches) shares one contract. Bounded so long-lived
     * hosts never grow it without limit; a reclaimed snapshot simply re-mints
     * under the then-current projection state, which is correct for any step
     * still open.
     */
    const snapshots = new Map<Agent, { turn: number; step: number; shape: TurnShape }>()
    /**
     * One `[turn-shape]` reminder per (agent, turn, shape) epoch, delivered at
     * the first step admission that resolves under it — step 1 for a shape
     * armed before the turn, the very next step for a mid-turn pick. Turn
     * rollover remints; narrate erases the epoch, so re-entering a shaped epoch
     * re-notifies exactly once.
     */
    const reminders = new Map<Agent, { turn: number; shape: TurnShape }>()
    const MAX_SNAPSHOTS = 64
    const evict = (key: Agent): void => {
      snapshots.delete(key)
      reminders.delete(key)
    }
    const resolveShape = (agent: Agent, turn: number, step: number): TurnShape => {
      const snapshot = snapshots.get(agent)
      if (snapshot !== undefined && snapshot.turn === turn && snapshot.step === step) return snapshot.shape
      const shape = scoped.sessionProjections.stateOf(agent.session, 'turnShape')?.shape ?? DEFAULT_SHAPE
      while (snapshots.size >= MAX_SNAPSHOTS) {
        const oldest = snapshots.keys().next()
        if (oldest.done === true) break
        evict(oldest.value)
      }
      snapshots.set(agent, { turn, step, shape })
      return shape
    }

    // One reminder per shape epoch, delivered at the first step admission
    // that resolves under it — step 1 for a shape armed before the turn, the
    // very next step for a mid-turn pick.
    scoped.on('agent/pre-step', async ({ agent, turn, step }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      const shape = resolveShape(agent, turn, step)
      if (shape === 'narrate') {
        reminders.delete(agent)
        return decision
      }
      const epoch = reminders.get(agent)
      if (epoch !== undefined && epoch.turn === turn && epoch.shape === shape) return decision
      reminders.set(agent, { turn, shape })
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
