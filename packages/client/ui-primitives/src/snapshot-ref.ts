/**
 * Snapshot stop addresses and turn frames: the `@` grammar over the log's
 * own identity stack (`path#turn#call-id`, `#gap` in the turn slot when the
 * call never logged one), and the turn-start/turn-end frame one session's
 * `checkpoint/scan` fold determines per file.
 *
 * @module @deepseek-ai/dsh-client-ui-primitives/snapshot-ref
 */
import { structuredPatch } from 'diff'

/** The turn slot a stop takes when its call never logged a turn. */
export const GAP_TURN = 'gap'

/** One snapshot address: path, turn (or 'gap'), tool-call id. */
export interface SnapshotRef {
  readonly path: string
  readonly turn: number | typeof GAP_TURN
  readonly callId: string
}

/** One file stop, structurally: what an address and a frame need. */
export interface SnapshotStop {
  readonly callId: string
  /** Turn the capturing call logged, absent when it never did. */
  readonly turn?: number
  /** Content digest before the change; absent on first appearance. */
  readonly before?: string
  /** Content digest after the change; absent when the file left. */
  readonly after?: string
  /** The scan could not vouch for continuity from the prior stop. */
  readonly gap?: true
}

/**
 * Parse the `@`-less address `path#turn#call-id`; the path is everything
 * before the last two `#` separators, so paths may themselves contain `#`.
 * @param ref - the address text following `@`.
 * @returns the ref, or undefined on any malformed part.
 */
export function parseSnapshotRef(ref: string): SnapshotRef | undefined {
  const callAt = ref.lastIndexOf('#')
  if (callAt < 1 || ref.length === callAt + 1) return undefined
  const callId = ref.slice(callAt + 1)
  const turnAt = ref.lastIndexOf('#', callAt - 1)
  if (turnAt < 1 || turnAt >= callAt - 1) return undefined
  const turnText = ref.slice(turnAt + 1, callAt)
  const path = ref.slice(0, turnAt)
  if (path === '' || callId.includes('#')) return undefined
  if (turnText === GAP_TURN) return { path, turn: GAP_TURN, callId }
  if (!/^\d+$/.test(turnText)) return undefined
  return { path, turn: Number(turnText), callId }
}

/**
 * The ref's serialized form, round-tripping `parseSnapshotRef`.
 * @param ref - the address to print.
 * @returns `path#turn#callId`, `gap` in the turn slot where needed.
 */
export function serializeSnapshotRef(ref: SnapshotRef): string {
  return `${ref.path}#${ref.turn}#${ref.callId}`
}

/**
 * The stop a ref names; the call id keys a stop, so the path and turn
 * half of the address only disambiguate prose.
 * @param ref - the parsed address.
 * @param stops - the candidate stops of one session, any file order.
 * @returns the stop whose call id matches, or undefined.
 */
export function findStop(ref: SnapshotRef, stops: readonly SnapshotStop[]): SnapshotStop | undefined {
  return stops.find(stop => stop.callId === ref.callId)
}

/** One turn's snapshot half: the stop visible at that edge. */
export interface TurnEdgeStop {
  readonly callId: string
  readonly before?: string
  readonly after?: string
  readonly gap?: true
}

/** One turn's snapshot frame, reconstructed from stops alone. */
export interface TurnFrame {
  readonly turn: number
  /** The file's stop at the turn's start: undefined when the file is new this turn. */
  readonly start: TurnEdgeStop | undefined
  /** The file's stop at the turn's end: undefined when the file left the workspace. */
  readonly end: TurnEdgeStop | undefined
  /** A stop inside the frame carries a broken chain. */
  readonly broken: boolean
}

/**
 * Reconstruct one file turn's frame from its stops: the start edge is the
 * first in-turn stop, whose `before` is the pre-turn state (absent when
 * the file is new); the end edge is the last in-turn stop, whose `after`
 * absence means the file left. A `gap` stop or a first stop whose
 * `before` does not chain makes the frame broken, without losing either
 * edge.
 * @param stops - one file's stops, oldest first.
 * @param turn - the turn to frame.
 * @returns the frame, or undefined when the turn touched nothing.
 */
export function frameForTurn(stops: readonly SnapshotStop[], turn: number): TurnFrame | undefined {
  const inTurn = stops.filter(stop => stop.turn === turn)
  const first = inTurn[0]
  const last = inTurn[inTurn.length - 1]
  if (first === undefined || last === undefined) return undefined
  const prior = stops.slice(0, stops.indexOf(first)).reverse()
    .find(stop => stop.turn !== undefined && stop.turn < turn)
  let start: TurnEdgeStop | undefined
  if (first.before !== undefined) {
    start = {
      callId: first.callId,
      before: first.before,
      ...(first.gap === true ? { gap: true as const } : {}),
    }
  }
  else if (prior !== undefined) {
    start = {
      callId: prior.callId,
      ...(prior.after === undefined ? {} : { after: prior.after }),
    }
  }
  const end = last.after === undefined
    ? undefined
    : { callId: last.callId, after: last.after }
  return { turn, start, end, broken: inTurn.some(stop => stop.gap === true) }
}

/**
 * The line-count diff of two snapshot texts, the same pure patch the
 * frozen unified view renders.
 * @param before - the prior edge's text, undefined before first appearance.
 * @param after - the later edge's text, undefined when the file left.
 * @returns added and removed line counts across the whole patch.
 */
export function frameDiff(before: string | undefined, after: string | undefined): { added: number; removed: number } {
  const patch = structuredPatch('', '', before ?? '', after ?? '', undefined, undefined, { context: 3 })
  let added = 0
  let removed = 0
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  return { added, removed }
}
