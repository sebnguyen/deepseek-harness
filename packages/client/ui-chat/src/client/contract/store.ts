/** Chat-owned per-Session view state. */

/** Tool call identity as carried by Chat nodes. */
export type ToolCallId = string

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  /** Span keys whose folded member rows the user revealed. */
  openSpans: string[]
}
