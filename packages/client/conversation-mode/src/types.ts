/**
 * Turn-shape domain types: the ONE home of the shape taxonomy, its logged
 * `turn-shape/mode` session event, and the `turnShape` projection-key
 * declarations, free of this package's host-side value imports. Host
 * consumers read `./types`; client bundles import the same pure file.
 * @module @deepseek-ai/dsh-client-conversation-mode/types
 */

/** The three turn shapes the selector offers. */
export const TURN_SHAPES = ['narrate', 'quiet', 'tools'] as const

/** One turn shape: `narrate` is the stock transcript; `quiet` closes with one plain answer; `tools` ends without a summary. */
export type TurnShape = typeof TURN_SHAPES[number]

/** Shape when the session log carries no `turn-shape/mode` event. */
export const DEFAULT_SHAPE: TurnShape = 'narrate'

/** Complete logged turn-shape selection for one session. */
export interface TurnShapeSelection {
  /** The shape in force from the event on. */
  readonly shape: TurnShape
}

/** Host state folded by the `turnShape` projection unit. */
export interface TurnShapeUnitState {
  /** Last logged shape; `DEFAULT_SHAPE` before the first event. */
  shape: TurnShape
}

/** The `turnShape` projection's wire value (the unit's whole state). */
export interface TurnShapeProjection {
  /** Turn shape in force for the session. */
  shape: TurnShape
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's transcript turn shape from this point on: log-only,
     * non-surface, whole-value replace. The last `turn-shape/mode` wins; a
     * log with none folds to `narrate` through the projection unit's fold.
     */
    'turn-shape/mode': TurnShapeSelection
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host fold state of the session's turn shape. */
    turnShape: TurnShapeUnitState
  }
  interface SessionProjectionMap {
    /** Turn shape folded from `turn-shape/mode` events; capability absence (conversation-mode not composed) is the key's absence. */
    turnShape: TurnShapeProjection
  }
}
