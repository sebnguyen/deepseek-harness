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
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import { turnShapeReminderText, type TurnShapeSource } from './turn-shape.ts'
import {
  TURN_SHAPE_SETTINGS_NAMESPACE,
  TurnShapeSettingsSchema,
  normalizeTurnShape,
  type TurnShape,
  type TurnShapeSettings,
} from './turn-shape-settings.ts'

/** Host plugin body: the shape snapshot and the per-turn reminder. */
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
