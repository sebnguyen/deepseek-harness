/**
 * Turn-shape wire constants: the per-turn reminder rendering, the grammar
 * hints attached on capable routes, and the quiet wrap-up cue. Turn
 * termination stays the loop's natural zero-tool-call ending (an assistant
 * message with zero tool calls); quiet adds exactly one unshielded wrap-up
 * step after that natural stop, and `tools` adds nothing.
 * @module @deepseek-ai/dsh-client-conversation-mode/turn-shape
 */

import type { StructuredOutputSchema } from '@deepseek-ai/dsh-llm'
import type { TurnShape } from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** The per-turn shape reminder injected at the turn's first step, or the quiet wrap-up cue. */
    'turn-shape': TurnShapeSource
  }
}

/** Source tag of the injected shape-reminder / wrap-up message. */
export interface TurnShapeSource {
  kind: 'turn-shape'
  /** The shape in effect for the turn the message rendered on. */
  turnShape: TurnShape
}

/**
 * The strict empty-object leak shield: the shape's only structured-output
 * hint, binding a quiet/tools working step's text channel to the two-token
 * `{}` that the render contract sanitizes away. Attached only to routes
 * whose adapter declares real `response_format` support, and never to the
 * quiet wrap-up step or alongside a higher-priority capture schema.
 */
export const EMPTY_OBJECT_SCHEMA: StructuredOutputSchema = Object.freeze({
  type: 'object',
  properties: {},
  additionalProperties: false,
  strict: true,
})

/** One-line phrases the reminder uses to name each shape's transcript promise. */
const REMINDER_LINES: Record<Exclude<TurnShape, 'narrate'>, string> = {
  quiet: 'thoughts and tool rows; close the turn with one plain answer',
  tools: 'thoughts and tool rows; the turn ends without a summary',
}

/**
 * Render the per-turn shape reminder injected at step 1 of a non-narrate
 * turn. Kept to one line in transcript terms: this is the shape's standing
 * model-facing instruction, and it travels in full on every route.
 * @param shape - the turn's snapshotted shape (never narrate).
 * @returns the reminder body.
 */
export function turnShapeReminderText(shape: Exclude<TurnShape, 'narrate'>): string {
  return `[turn-shape] Turn shape: ${shape} — ${REMINDER_LINES[shape]}.`
}

/**
 * The one-shot wrap-up cue steered after a quiet turn's natural stop. The
 * wrap-up step is the one quiet request that goes out with no grammar hint,
 * so the closing plain answer the shape promises can be emitted in full.
 * @returns the wrap-up cue body.
 */
export function turnShapeWrapUpText(): string {
  return '[turn-shape] Close now: one plain final answer, no tool calls.'
}
