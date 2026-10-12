/**
 * Turn-shape wire constants: the per-turn reminder rendering. The plugin
 * attaches no request-grammar fields in any form — the retired strict
 * empty-object shield took the provider's reasoning channel down with the
 * leaked prose it guarded against, so thoughts render in every shape now —
 * and turn termination stays the loop's natural zero-tool-call ending (an
 * assistant message with zero tool calls).
 * @module @deepseek-ai/dsh-client-conversation-mode/turn-shape
 */

import type { TurnShape } from './types.ts'

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
  quiet: 'thoughts and tool rows; close the turn with one plain answer',
  tools: 'thoughts and tool rows; the turn ends without a summary',
}

/**
 * Render the per-turn shape reminder injected at step 1 of a non-narrate
 * turn. Kept to one line in transcript terms: this is the shape's only
 * model-facing instruction, and it travels in full on every route.
 * @param shape - the turn's snapshotted shape (never narrate).
 * @returns the reminder body.
 */
export function turnShapeReminderText(shape: Exclude<TurnShape, 'narrate'>): string {
  return `[turn-shape] Turn shape: ${shape} — ${REMINDER_LINES[shape]}.`
}
