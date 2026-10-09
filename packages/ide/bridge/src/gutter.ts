/**
 * The turn-authored gutter: merge the session's turn spans on one file into
 * the decoration bands the frame paints left of the line numbers. Pure over a
 * band-applying face so the decoration API never leaks into the model.
 */

/** One raw turn span before merging. */
export interface TurnSpan {
  readonly startLine: number
  readonly endLine: number
  readonly turn: number
}

/** One merged decoration band. */
export interface TurnBand {
  readonly startLine: number
  readonly endLine: number
  readonly turn: number
}

/** The decoration face the frame's built-in provides. */
export interface GutterFace {
  apply(bands: readonly TurnBand[]): void
  clear(): void
}

/**
 * Merge overlapping or adjacent same-turn spans into bands sorted by start
 * line; foreign turns interleave without merging.
 * @param spans - the raw session turn spans on the file.
 * @returns the merged bands.
 */
export function mergeBands(spans: readonly TurnSpan[]): TurnBand[] {
  const sorted = [...spans].sort((a, b) => a.startLine - b.startLine || a.turn - b.turn)
  const bands: TurnBand[] = []
  for (const span of sorted) {
    const last = bands.at(-1)
    if (last !== undefined && last.turn === span.turn && span.startLine <= last.endLine + 1) {
      bands[bands.length - 1] = { turn: last.turn, startLine: last.startLine, endLine: Math.max(last.endLine, span.endLine) }
    }
    else bands.push({ ...span })
  }
  return bands
}

/**
 * Present the merged bands, clearing first so a file with no authored lines
 * renders no stale bands.
 * @param gutter - the decoration face.
 * @param spans - the raw spans.
 * @returns the bands applied.
 */
export function presentGutter(gutter: GutterFace, spans: readonly TurnSpan[]): readonly TurnBand[] {
  gutter.clear()
  const bands = mergeBands(spans)
  if (bands.length > 0) gutter.apply(bands)
  return bands
}
