/**
 * One-page unified projection: numbers on both gutters, context windows,
 * and newline-marker silence.
 */
import { describe, expect, it } from 'vitest'
import { unifiedLines } from '@deepseek-ai/dsh-client-ui-primitives'

describe('unifiedLines', () => {
  it('numbers context on both sides and deltas on one', () => {
    const lines = unifiedLines('a\nb\nc\n', 'a\nX\nc\n')
    expect(lines).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'removed', oldLine: 2, text: 'b' },
      { kind: 'added', newLine: 2, text: 'X' },
      { kind: 'context', oldLine: 3, newLine: 3, text: 'c' },
    ])
  })

  it('keeps three-line context windows around distant hunks', () => {
    const head = 'l1\nl2\nl3\nl4\n'
    const tail = 'l9\nl10\nl11\nl12\n'
    const before = head + 'oldA\n' + tail
    const after = head + 'newA\n' + 'newB\n' + tail
    const lines = unifiedLines(before, after)
    expect(lines.at(0)).toEqual({ kind: 'context', oldLine: 2, newLine: 2, text: 'l2' })
    expect(lines.at(-1)).toEqual({ kind: 'context', oldLine: 8, newLine: 9, text: 'l11' })
    expect(lines.filter(line => line.kind !== 'context')).toHaveLength(3)
  })

  it('treats an absent side as empty text', () => {
    expect(unifiedLines(undefined, 'x\n')).toEqual([{ kind: 'added', newLine: 1, text: 'x' }])
    expect(unifiedLines('x\n', undefined)).toEqual([{ kind: 'removed', oldLine: 1, text: 'x' }])
  })

  it('is empty for identical sides and drops newline markers', () => {
    expect(unifiedLines('same\n', 'same\n')).toEqual([])
    const lines = unifiedLines('a\n', 'b')
    expect(lines.map(line => line.kind)).toEqual(['removed', 'added'])
    expect(lines[1]?.text).toBe('b')
  })
})
