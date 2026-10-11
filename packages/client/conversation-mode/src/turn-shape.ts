/**
 * Turn-shape wire constants: the strict empty-object working-step shield and
 * the per-turn reminder rendering. No `quiet_finish` equivalent exists — the
 * plugin attaches no toolChoice in any form, so the loop's natural turn
 * ending (an assistant message with zero tool calls) is the only termination
 * grammar in play.
 * @module @deepseek-ai/dsh-client-conversation-mode/turn-shape
 */

import type { StructuredOutputSchema } from '@deepseek-ai/dsh-llm'
import type { TurnShape } from './turn-shape-settings.ts'

/**
 * Response grammar for quiet/tools working steps: any leaked answer text is
 * bound to `{}` (~2 tokens), the cost guard the retired `toolChoice:
 * 'required'` enforcement was bought with. Attached only when the route's
 * resolved capability promises grammar-decoding; the render contract in
 * ui-chat absorbs the artifact when it nonetheless surfaces.
 */
export const EMPTY_OBJECT_SCHEMA: StructuredOutputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
  // The shield only binds with grammar decoding: non-strict json_schema is
  // best-effort and leaks free answer text.
  strict: true,
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** The per-turn shape reminder injected at the turn's first step. */
    'turn-shape': TurnShapeSource
  }
}

/** Source tag of the injected shape-reminder message. */
export interface TurnShapeSource {
  kind: 'turn-shape'
  /** The shape in effect for the turn the reminder rendered on. */
  turnShape: TurnShape
}

/** One-line phrases the reminder uses to name each shape's transcript promise. */
const REMINDER_LINES: Record<Exclude<TurnShape, 'narrate'>, string> = {
  quiet: 'tool rows only; close the turn with one plain answer',
  tools: 'tool rows only; the turn ends without a summary',
}

/**
 * Render the per-turn shape reminder injected at step 1 of a non-narrate
 * turn. Kept to one line in transcript terms: this is the shape's only
 * load-bearing model-facing instruction, and it must hold on routes where
 * the shield is withheld.
 * @param shape - the turn's snapshotted shape (never narrate).
 * @returns the reminder body.
 */
export function turnShapeReminderText(shape: Exclude<TurnShape, 'narrate'>): string {
  return `[turn-shape] Turn shape: ${shape} — ${REMINDER_LINES[shape]}.`
}
