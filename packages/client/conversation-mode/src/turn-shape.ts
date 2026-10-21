/**
 * Turn-shape wire constants: the soft per-turn reminder that names the shape's
 * transcript promise. Turn termination stays the loop's ordinary kinds — the
 * natural zero-tool-call ending or an explicit `finish`. Quiet is a render
 * filter, not a generation constraint: no grammar hints, no wrap-up call.
 * @module @deepseek-ai/dsh-client-conversation-mode/turn-shape
 */

import type { TurnShape } from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** The shape reminder injected on a shape epoch. */
    'turn-shape': TurnShapeSource
  }
}

/** Source tag of the injected shape-reminder message. */
export interface TurnShapeSource {
  kind: 'turn-shape'
  /** The shape in effect for the turn the message rendered on. */
  turnShape: TurnShape
}

/** One-line phrases the reminder uses to name each shape's transcript promise. */
const REMINDER_LINES: Record<Exclude<TurnShape, 'narrate'>, string> = {
  quiet:
    'work through thoughts and tool calls; narrate nothing now, and answer only '
    + 'when the work is done. Intermediate prose and thinking are hidden at render time',
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
