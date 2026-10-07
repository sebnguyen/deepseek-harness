/** Covers the pruned workspace walk, the ignore matcher, and the stat diff. */

import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SimpleIgnoreMatcher, diffStates, walkWorkspace } from '../src/index.ts'
import type { ScanState } from '../src/index.ts'

/** Write one file, creating its parent directories. */
async function put(root: string, rel: string, body: string): Promise<void> {
  await mkdir(join(root, rel, '..'), { recursive: true })
  await writeFile(join(root, rel), body, 'utf8')
}

describe('SimpleIgnoreMatcher', () => {
  it('parses the supported gitignore forms and ignores comments, blanks, and negations', () => {
    const matcher = SimpleIgnoreMatcher.parse([
      '# comment',
      '',
      'dist/',
      '/rooted.txt',
      '*.log',
      'bare.txt',
      '!keep.log',
      '   ',
    ].join('\n'))
    expect(matcher.matches('dist')).toBe(true)
    expect(matcher.matches('dist/nested/a.js')).toBe(true)
    expect(matcher.matches('pkg/dist/a.js')).toBe(true)
    expect(matcher.matches('other/dist')).toBe(true)
    expect(matcher.matches('rooted.txt')).toBe(true)
    expect(matcher.matches('sub/rooted.txt')).toBe(false)
    expect(matcher.matches('a/b/run.log')).toBe(true)
    expect(matcher.matches('bare.txt')).toBe(true)
    expect(matcher.matches('nested/bare.txt')).toBe(true)
    expect(matcher.matches('kept.ts')).toBe(false)
  })

  it('matches nothing when the body is empty', () => {
    expect(SimpleIgnoreMatcher.parse('').matches('anything.txt')).toBe(false)
  })
})

describe('walkWorkspace', () => {
  it('keeps files and prunes repository, dependency, and ignore-matched trees', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-checkpoint-scan-'))
    await put(root, 'a.txt', 'a')
    await put(root, 'sub/b.txt', 'b')
    await put(root, 'sub/deep/c.txt', 'c')
    await put(root, 'node_modules/pkg/index.js', 'x')
    await put(root, '.git/HEAD', 'ref')
    await put(root, 'dist/bundle.js', 'x')
    await put(root, 'debug.log', 'x')
    await put(root, 'vendor/v.js', 'x')

    const ignore = SimpleIgnoreMatcher.parse('dist/\n*.log\n')
    const state = await walkWorkspace(root, ignore, new Set(['vendor']))
    expect([...state.keys()].sort()).toEqual(['a.txt', 'sub/b.txt', 'sub/deep/c.txt'])
    expect(state.get('a.txt')?.size).toBe(1)
    expect(state.get('a.txt')?.mtimeMs).toBeGreaterThan(0)
  })

  it('resolves a missing root as an empty sweep instead of throwing', async () => {
    const state = await walkWorkspace(join(tmpdir(), 'dsh-checkpoint-absent-root'), SimpleIgnoreMatcher.parse(''))
    expect(state.size).toBe(0)
  })
})

describe('diffStates', () => {
  it('reports added, changed, and removed paths in sorted order', () => {
    const before: ScanState = new Map([
      ['b.txt', { mtimeMs: 1, size: 1 }],
      ['gone.txt', { mtimeMs: 1, size: 1 }],
      ['same.txt', { mtimeMs: 5, size: 5 }],
    ])
    const after: ScanState = new Map([
      ['b.txt', { mtimeMs: 2, size: 1 }],
      ['new.txt', { mtimeMs: 3, size: 3 }],
      ['same.txt', { mtimeMs: 5, size: 5 }],
    ])
    expect(diffStates(before, after)).toEqual({ added: ['new.txt'], changed: ['b.txt'], removed: ['gone.txt'] })
  })

  it('treats a size change without an mtime change as changed', () => {
    const before: ScanState = new Map([['a.txt', { mtimeMs: 9, size: 1 }]])
    const after: ScanState = new Map([['a.txt', { mtimeMs: 9, size: 2 }]])
    expect(diffStates(before, after).changed).toEqual(['a.txt'])
  })
})
