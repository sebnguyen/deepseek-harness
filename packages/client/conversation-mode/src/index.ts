/**
 * Turn-shape conversation modes, host half.
 *
 * The shape promises a transcript property (narrate / quiet / tools), and
 * that promise is owned by the ui-chat render contract — never by request
 * grammar. What this plugin does model-side is deliberately small:
 *
 * - **A per-turn snapshot.** The first admission of each turn (the step-1
 *   pre-step, before any request is built) fixes the turn's shape. Switching
 *   the selector mid-turn changes the live setting, never the open turn;
 *   the snapshot is keyed by (session, turn), so concurrent sessions cannot
 *   steal each other's shape the way ui-quiet's module-global flag did.
 * - **A one-line reminder** injected into every turn of a non-narrate shape,
 *   stating the transcript promise in one sentence. This is the shape's only
 *   load-bearing model-facing instruction.
 * - **A strict empty-object `structuredOutput` shield** on working steps,
 *   contributed at the arbitration's preference band (`turnShape`) so a
 *   capture driver's schema always overrides it, and attached only when the
 *   route's per-route capability verdict is positive — an adapter that
 *   cannot grammar-decode sees no draft fields from this plugin at all. The
 *   plugin attaches **no `toolChoice` in any form**: turn termination stays
 *   the loop's natural zero-tool-call rule, and the retired `quiet_finish`
 *   stop tool and its `pendingFinish` module state are gone for good.
 *
 * `narrate` performs no injection at all.
 */

import type { Context } from '@deepseek-ai/cordis'
import { GRAMMAR_PRIORITY, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, NO_GRAMMAR_SUPPORT, type LlmRouteGrammarSupport, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import { EMPTY_OBJECT_SCHEMA, turnShapeReminderText, type TurnShapeSource } from './turn-shape.ts'
import {
  TURN_SHAPE_SETTINGS_NAMESPACE,
  TurnShapeSettingsSchema,
  normalizeTurnShape,
  type TurnShape,
  type TurnShapeSettings,
} from './turn-shape-settings.ts'

/** Host plugin body: the shape snapshot, the reminder, and the shield contribution. */
export function apply(ctx: Context): void {
  /** Current configuration source: the settings scope while attached, the new default otherwise. */
  let source: () => TurnShapeSettings = () => ({})
  /** Live shape read; consulted only when a turn's snapshot is minted. */
  const liveShape = (): TurnShape => normalizeTurnShape(source())

  /**
   * Per-session turn shape snapshot. Minted lazily at the first admission of
   * a (session, turn) pair — the step-1 pre-step of the turn, which precedes
   * its first request — so a mid-turn selector change applies from the next
   * turn exactly. Bounded so long-lived hosts never grow it without limit;
   * a reclaimed snapshot simply re-mints under the then-current setting,
   * which is correct for any turn still open.
   */
  const snapshots = new Map<SessionId, { turn: number; shape: TurnShape }>()
  const MAX_SNAPSHOTS = 64
  const shapeForTurn = (sessionId: SessionId, turn: number): TurnShape => {
    const snapshot = snapshots.get(sessionId)
    if (snapshot !== undefined) {
      if (snapshot.turn === turn) return snapshot.shape
      snapshots.delete(sessionId)
    }
    const shape = liveShape()
    while (snapshots.size >= MAX_SNAPSHOTS) {
      const oldest = snapshots.keys().next()
      if (oldest.done === true) break
      snapshots.delete(oldest.value)
    }
    snapshots.set(sessionId, { turn, shape })
    return shape
  }

  /**
   * Route grammar support. Queried per request and defaulted conservatively
   * until the llm service arrives, so this plugin never attaches grammar
   * ahead of the capability surface mounting.
   */
  let capability: (provider: string, model: string) => LlmRouteGrammarSupport = () => NO_GRAMMAR_SUPPORT
  ctx.inject(['llm'], (llmCtx) => {
    capability = (provider, model) => llmCtx.llm.grammarCapability(provider, model)
  })

  // The per-turn reminder rides step-1 admission, mirroring the other
  // turn-context reminders (staging ladder, repeat-tool).
  ctx.on('agent/pre-step', async ({ agent, turn, step }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind !== 'enter' || step !== 1) return decision
    const shape = shapeForTurn(agent.id, turn)
    if (shape === 'narrate') return decision
    const reminderSource: TurnShapeSource = { kind: 'turn-shape', turnShape: shape }
    const reminder: UserMessage = createUserMessage({
      content: [{ type: 'text', text: turnShapeReminderText(shape) }],
      source: reminderSource,
    })
    return { ...decision, messages: [...decision.messages, reminder] }
  })

  // The shield joins the declared arbitration registry at the preference
  // band: structural writers (capture schemas, staging constraints) always
  // override it, in every composition order.
  ctx.inject(['request-grammar'], (grammarCtx) => {
    const dispose = grammarCtx['request-grammar'].contribute({
      id: 'conversation-turn-shape',
      priority: GRAMMAR_PRIORITY.turnShape,
      attach: ({ agent, turn, config }) => {
        if (shapeForTurn(agent.id, turn) === 'narrate') return undefined
        if (!capability(config.provider, config.model).structuredOutput) return undefined
        return { structuredOutput: EMPTY_OBJECT_SCHEMA }
      },
    })
    ctx.effect(() => dispose, 'conversation-mode turn-shape grammar contribution teardown')
  })

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, TURN_SHAPE_SETTINGS_NAMESPACE, TurnShapeSettingsSchema, {}, {
      setSource: (current) => {
        source = current
      },
      // Shape reads are lazy per turn, so there is no cache to invalidate.
      onChange: () => {},
    })
  })
}
