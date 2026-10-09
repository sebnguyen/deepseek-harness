/**
 * The gutter's line-number projection: after-side added and before-side
 * removed numbers off the shared unified patch, clamped and deduplicated
 * for the marker field.
 */
import { describe, expect, it } from 'vitest'
import { changedLines, markerLines } from '../src/client/change-lines.ts'

describe('changedLines', () => {
  it('reports every line as added before first appearance', () => {
    expect(changedLines(undefined, 'one\ntwo\n')).toEqual({ added: [1, 2], removed: [] })
  })

  it('reports every line as removed when the file left', () => {
    expect(changedLines('one\ntwo\n', undefined)).toEqual({ added: [], removed: [1, 2] })
  })

  it('pairs rewritten lines by side', () => {
    expect(changedLines('a\nb\nc\n', 'a\nx\nc\n')).toEqual({ added: [2], removed: [2] })
  })

  it('identical texts change nothing', () => {
    expect(changedLines('same\n', 'same\n')).toEqual({ added: [], removed: [] })
  })
})

describe('markerLines', () => {
  it('merges both sides, ascending and deduplicated', () => {
    expect(markerLines({ added: [3, 1], removed: [3, 5] }, 6)).toEqual([1, 3, 5])
  })

  it('clamps removed lines past a shrunken document and drops line zero', () => {
    expect(markerLines({ added: [1], removed: [4, 9] }, 2)).toEqual([1, 2])
  })

  it('an empty change marks nothing', () => {
    expect(markerLines({ added: [], removed: [] }, 10)).toEqual([])
  })
})
