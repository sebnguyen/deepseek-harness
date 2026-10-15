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
 *   exactly once.
 * - **Request-grammar hints on capable routes only.** Under `quiet` and
 *   `tools` the plugin contributes two fields at the declared
 *   `GRAMMAR_PRIORITY.turnShape` band through the arbitration seam: an
 *   explicit `toolChoice: 'auto'` and the strict empty-object
 *   `structuredOutput` shield ({@link EMPTY_OBJECT_SCHEMA}), whose `{}`
 *   output channel the render contract sanitizes away. Both attach only
 *   where `llm.grammarCapability` resolves true for the request's route —
 *   capability-negative routes (and any composition without the `llm`
 *   service) run reminder-only. A capture driver's schema at a higher band
 *   always wins the `structuredOutput` slot.
 * - **Quiet closes with one unshielded wrap-up step.** When a quiet turn
 *   reaches its natural zero-tool-call ending, the `agent/turn-stopping`
 *   dispatch steers exactly one continuation asking for the plain closing
 *   answer, and the grammar contribution abstains for the rest of that
 *   turn, so the closing answer goes out with no restriction. `tools`
 *   steers nothing: the turn ends when the agent ends it.
 *
 * `narrate` performs no injection at all.
 *
 * Agent Notes:
 * - .agents/notes/implemented/feature/2026-10-13-conversation-mode-grammar-hints.md
 * - .agents/notes/implemented/architecture/2026-10-12-turn-shape-session-scope.md
 */

import type { Context } from '@deepseek-ai/cordis'
import { GRAMMAR_PRIORITY, type Agent, type PreStepDecision, type RequestGrammarPatch } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { } from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import {
  EMPTY_OBJECT_SCHEMA, turnShapeReminderText, turnShapeWrapUpText, type TurnShapeSource,
} from './turn-shape.ts'
import {
  DEFAULT_SHAPE, TURN_SHAPES, type TurnShape, type TurnShapeProjection, type TurnShapeUnitState,
} from './types.ts'

export type * from './types.ts'
export {
  EMPTY_OBJECT_SCHEMA,
  turnShapeReminderText,
  turnShapeWrapUpText,
  type TurnShapeSource,
} from './turn-shape.ts'

/** Conversation-mode configuration accepted from cordis.yml `config:`. */
export interface ConversationModeConfig {
  /**
   * Attach the request-grammar hints (`toolChoice: 'auto'` plus the strict
   * empty-object shield) to quiet/tools requests. The hints attach only on
   * routes whose adapter capability resolves true; the quiet wrap-up step
   * always goes out unrestricted.
   * @defaultValue true
   */
  grammarHints?: boolean
}

/**
 * Runtime schema for {@link ConversationModeConfig}.
 * A cordis.yml row with no `config` arrives as `undefined` and validates as `{}`.
 */
export const Config = z.object({
  grammarHints: z.boolean().optional(),
}).default({}) as unknown as z.ZodType<ConversationModeConfig>

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

/**
 * Host plugin body: the projection registration, the per-turn snapshot, the
 * per-turn reminder, the capability-gated grammar contribution, and the
 * quiet wrap-up steer.
 * @param ctx - the plugin scope.
 * @param config - validated cordis.yml config.
 */
export function apply(ctx: Context, config: ConversationModeConfig = {}): void {
  // Resolution lives at composition, never inside a listener.
  const grammarHints = config.grammarHints ?? true
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
    /**
     * The (agent, turn) pair whose natural stop already fired the quiet
     * wrap-up. Sheltered from re-mint like the snapshot it rides: the wrap-up
     * cue steers once per turn, and the grammar contribution abstains for
     * the armed turn's remaining requests so the closing answer goes out
     * with the restriction removed.
     */
    const wrapUps = new Map<Agent, number>()
    const MAX_SNAPSHOTS = 64
    const evict = (key: Agent): void => {
      snapshots.delete(key)
      reminders.delete(key)
      wrapUps.delete(key)
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

    // A quiet turn's natural zero-tool-call stop is followed by exactly one
    // steered wrap-up step; a second stop in the same turn closes for real.
    // The stop decision reads the projection at the stop moment: a quiet
    // turn flipped to narrate mid-turn closes unsteered (the rescue case).
    scoped.on('agent/turn-stopping', ({ agent, turn }) => {
      const shape = scoped.sessionProjections.stateOf(agent.session, 'turnShape')?.shape ?? DEFAULT_SHAPE
      if (shape !== 'quiet') return
      if (wrapUps.get(agent) === turn) return
      wrapUps.set(agent, turn)
      const wrapUpSource: TurnShapeSource = { kind: 'turn-shape', turnShape: 'quiet' }
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: turnShapeWrapUpText() }],
        source: wrapUpSource,
      }))
    })

    // The grammar hints need the capability query; no `llm` service means the
    // composition runs reminder-only, and no `request-grammar` service means
    // arbitration is absent outright. Guarded by the declared config.
    if (grammarHints) {
      scoped.inject(['llm', 'request-grammar'], (grammarCtx) => {
        const dispose = grammarCtx['request-grammar'].contribute({
          id: 'conversation-mode:turn-shape',
          priority: GRAMMAR_PRIORITY.turnShape,
          attach: (draft) => {
            if (resolveShape(draft.agent, draft.turn, draft.step) === 'narrate') return undefined
            if (wrapUps.get(draft.agent) === draft.turn) return undefined
            const support = grammarCtx.llm.grammarCapability(
              draft.config.provider,
              draft.config.model,
            )
            const patch: RequestGrammarPatch = {
              ...support.structuredOutput ? { structuredOutput: EMPTY_OBJECT_SCHEMA } : {},
              ...support.toolChoice ? { toolChoice: 'auto' as const } : {},
            }
            return patch.structuredOutput === undefined && patch.toolChoice === undefined
              ? undefined
              : patch
          },
        })
        grammarCtx.effect(() => dispose, 'turn-shape grammar contribution teardown')
      })
    }

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
