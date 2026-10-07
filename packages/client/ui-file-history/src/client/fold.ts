/**
 * Workspace timeline fold for the file-history view: reads the `checkpoint/scan`
 * rows a session logged and joins each to the `tool/call` that captured it, so
 * a stop carries its turn, step, and purpose without the row repeating them.
 *
 * @module ui-file-history/fold
 */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** One captured stop of one file, joined to the call whose scan recorded it. */
export interface FileStop {
  /** Sequence number of the `checkpoint/scan` event that carried this stop. */
  readonly seq: number
  /** Wall-clock time of that event. */
  readonly time: number
  /** The tool call whose bracket scan observed the change. */
  readonly callId: string
  /** Name of the tool that ran. */
  readonly toolName: string
  /** Why the call ran, when the caller stated one. */
  readonly purpose?: string
  /** Turn the call belonged to, absent when its `tool/call` event was never logged. */
  readonly turn?: number
  /** Step within that turn, absent with the turn. */
  readonly step?: number
  /** Content digest before the change; absent on the file's first appearance. */
  readonly before?: string
  /** Content digest after the change; absent when the file left the workspace. */
  readonly after?: string
}

/** Every captured stop of one file, oldest first. */
export interface FileTimeline {
  /** Session-relative path. */
  readonly path: string
  readonly stops: readonly FileStop[]
}

/** The folded workspace timeline the view renders. */
export interface FileHistorySnapshot {
  readonly files: readonly FileTimeline[]
}

/** Selector hook over the current Session's workspace snapshot timeline. */
export type UseFileHistory = SnapshotSelectorHook<FileHistorySnapshot>

/** The timeline of a session that captured nothing. */
export const EMPTY_FILE_HISTORY: FileHistorySnapshot = { files: [] }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SessionStandardProps {
    /** Selector hook over the current Session's workspace snapshot timeline. */
    useFileHistory: UseFileHistory
  }
}

/** Turn, step, and purpose of one call, read from its `tool/call` event. */
interface CallFacts {
  readonly turn: number
  readonly step: number
  readonly purpose?: string
}

/**
 * Fold one session's event window into per-file stop lists, oldest stop first.
 * @param entries - the session binding's live event window entries.
 * @returns every file the session changed, sorted by path, each with its stops.
 */
export function foldFileHistory(entries: readonly SessionEventLikeEntry[]): FileHistorySnapshot {
  const calls = new Map<string, CallFacts>()
  const stops = new Map<string, FileStop[]>()
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    const event = entry.event
    if (event.type === 'tool/call') {
      calls.set(event.data.callId, {
        turn: event.data.turn,
        step: event.data.step,
        ...event.data.purpose === undefined ? {} : { purpose: event.data.purpose },
      })
      continue
    }
    if (event.type !== 'checkpoint/scan') continue
    for (const row of event.data.rows) {
      const facts = calls.get(row.callId)
      const purpose = row.purpose ?? facts?.purpose
      const stop: FileStop = {
        seq: event.seq,
        time: event.time,
        callId: row.callId,
        toolName: row.toolName,
        ...purpose === undefined ? {} : { purpose },
        ...facts === undefined ? {} : { turn: facts.turn, step: facts.step },
        ...row.before === undefined ? {} : { before: row.before },
        ...row.after === undefined ? {} : { after: row.after },
      }
      const list = stops.get(row.path)
      if (list === undefined) stops.set(row.path, [stop])
      else list.push(stop)
    }
  }
  return {
    files: [...stops]
      .map(([path, list]) => ({ path, stops: list as readonly FileStop[] }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
}

/**
 * Zoom one file's stops to turn granularity: each turn keeps its last stop, the
 * file's state when that turn ended. Stops whose call was never logged stay
 * their own entry rather than merging into a neighbour they never shared a turn
 * with.
 * @param stops - one file's stops, oldest first.
 * @returns the collapsed stop list.
 */
export function groupStopsByTurn(stops: readonly FileStop[]): readonly FileStop[] {
  const grouped: FileStop[] = []
  let currentTurn: number | undefined
  for (const stop of stops) {
    if (stop.turn === undefined) {
      grouped.push(stop)
      currentTurn = undefined
      continue
    }
    if (stop.turn === currentTurn) grouped[grouped.length - 1] = stop
    else {
      grouped.push(stop)
      currentTurn = stop.turn
    }
  }
  return grouped
}
