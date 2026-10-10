/**
 * The DSH timeline glue: project the checkpoint register's per-file stops
 * onto the frame's view items and ride the checkpoint restore Remote for a
 * scrubbed stop. The webview holds no credentials; this glue is the only
 * part that touches the wire faces.
 */

/** One stop as the frame renders it, projected off `CheckpointStop`. */
export interface StopRecord {
  /** The turn the mutating tool call belonged to. */
  readonly turn: number
  /** The tool that ran. */
  readonly tool: string
  /** Content digest written. */
  readonly after: string
}

/** The checkpoint faces the timeline rides. */
export interface TimelineWireFace {
  stops(): Promise<readonly { readonly path: string; readonly stops: readonly import('@deepseek-ai/dsh-checkpoint/types').CheckpointStop[] }[]>
  restore(digest: string): Promise<void>
}

/** The frame-side view item, identical to the web sketch's chip row. */
export interface TimelineItem {
  readonly turn: number
  readonly tool: string
  readonly digest: string
  readonly label: string
}

/**
 * Project frame stop records onto view items, oldest first.
 * @param stops - the projected register stops.
 * @returns the view items with house label copy.
 */
export function projectStops(stops: readonly StopRecord[]): TimelineItem[] {
  return stops.map(stop => ({
    turn: stop.turn,
    tool: stop.tool,
    digest: stop.after,
    label: `turn ${stop.turn} · ${stop.tool}`,
  }))
}

/** Named refusal for scrubs the projection cannot serve. */
export class TimelineError extends Error {
  constructor(readonly code: 'ide/timeline-out-of-range', message: string) {
    super(message)
    this.name = 'TimelineError'
  }
}

/**
 * Restore one scrubbed stop; an index outside the projection refuses with a
 * named error instead of restoring a neighbor.
 * @param wire - the checkpoint faces.
 * @param items - the current projection.
 * @param index - the scrubbed item's index.
 */
export async function restoreAt(wire: TimelineWireFace, items: readonly TimelineItem[], index: number): Promise<void> {
  const item = items[index]
  if (item === undefined) throw new TimelineError('ide/timeline-out-of-range', `no timeline item at index ${index}`)
  await wire.restore(item.digest)
}
