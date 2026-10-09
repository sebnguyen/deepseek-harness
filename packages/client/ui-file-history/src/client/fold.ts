/**
 * Workspace timeline projection of the checkpoint slot register: maps each
 * file's `worktree` slots onto the stop timeline the surviving consumers type
 * against. Tombstones are already folded absent by the `slots` Remote, so the
 * input carries live slots only.
 *
 * @module ui-file-history/fold
 */
import type { CheckpointSlotTimeline } from '@deepseek-ai/dsh-checkpoint/types'
import { relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'

/** One captured stop of one file, projected from a `worktree` register slot. */
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

/** The folded workspace timeline the hook serves. */
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

/**
 * Project the register's per-file slot timelines onto per-file stop lists.
 * Only `worktree` slots carry a write capture; every other kind belongs to
 * another projection. Slot paths rooted at the session working directory fold
 * relative, so paths a capture recorded before relativization still join their
 * file's timeline.
 * @param timelines - the checkpoint register as the `slots` Remote returns it.
 * @param cwd - the session working directory; absolute slot paths rooted there fold relative.
 * @returns every file the session changed, sorted by path, stops sorted by creation time.
 */
export function foldSlotTimelines(timelines: readonly CheckpointSlotTimeline[], cwd?: string): FileHistorySnapshot {
  const stops = new Map<string, FileStop[]>()
  for (const timeline of timelines) {
    const path = relativizeToCwd(timeline.path, cwd)
    for (const slot of timeline.slots) {
      if (slot.kind !== 'worktree') continue
      const toolName = 'toolName' in slot.detail ? slot.detail.toolName : slot.label
      const purpose = 'purpose' in slot.detail && slot.detail.purpose !== undefined
        ? slot.detail.purpose
        // Registers captured before the detail carried the purpose rode it
        // as the slot label when one was stated.
        : slot.label !== toolName ? slot.label : undefined
      const stop: FileStop = {
        seq: slot.createdAt,
        time: slot.createdAt,
        callId: slot.callId ?? slot.slotId,
        toolName,
        ...purpose === undefined ? {} : { purpose },
        ...slot.turn === undefined ? {} : { turn: slot.turn },
        ...slot.before === undefined ? {} : { before: slot.before },
        ...slot.after === undefined ? {} : { after: slot.after },
      }
      const list = stops.get(path)
      if (list === undefined) stops.set(path, [stop])
      else list.push(stop)
    }
  }
  return {
    files: [...stops]
      .map(([filePath, list]) => ({
        path: filePath,
        stops: coalesceStops(list.sort((left, right) => left.time - right.time) as readonly FileStop[]),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
}

/**
 * Merge one file's back-to-back writes into the stop their burst ended at:
 * a stop whose `before` digest equals the previous stop's `after` observed no
 * outside write between the two, so the merged stop quotes the burst as one
 * change from the first before to the last after. A first appearance keeps
 * no before; a burst that ends by deleting the file keeps no after.
 * @param stops - one file's stops, oldest first.
 * @returns the burst-coalesced stop list.
 */
export function coalesceStops(stops: readonly FileStop[]): readonly FileStop[] {
  const merged: FileStop[] = []
  for (const stop of stops) {
    const head = merged[merged.length - 1]
    if (head !== undefined && head.after !== undefined && stop.before === head.after) {
      // The merged stop is the burst's end state quoting the burst's start:
      // the first before wins, a creation keeps no before at all.
      merged[merged.length - 1] = {
        seq: stop.seq,
        time: stop.time,
        callId: stop.callId,
        toolName: stop.toolName,
        ...stop.purpose === undefined ? {} : { purpose: stop.purpose },
        ...stop.turn === undefined ? {} : { turn: stop.turn },
        ...stop.step === undefined ? {} : { step: stop.step },
        ...head.before === undefined ? {} : { before: head.before },
        ...stop.after === undefined ? {} : { after: stop.after },
      }
      continue
    }
    merged.push(stop)
  }
  return merged
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
