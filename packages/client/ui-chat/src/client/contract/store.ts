/** Chat-owned per-Session view state. */

/** Tool call identity as carried by Chat nodes. */
export type ToolCallId = string

/** One manually expanded Turn process group. */
export interface TurnProcessViewEntry {
  readonly turn: number
  /** The settled answer step the wide open rides on; null while the Turn still runs. */
  readonly answerStep: number | null
  /** Start seq of the group the expansion rides on. */
  readonly group: number
}

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  turnProcesses: TurnProcessViewEntry[]
}
