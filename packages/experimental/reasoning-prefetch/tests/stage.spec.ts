import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsDirEntry, FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import { stageCandidates, type StageBudget } from '../src/stage.ts'
import type { ExtractedCandidate } from '../src/extract.ts'

const BUDGET: StageBudget = { maxFiles: 2, maxFileBytes: 32, maxTotalBytes: 64, listLines: 2 }

const target = (path: string): FsTarget => ({ targetKey: path as FsTarget['targetKey'], displayPath: path })

function fakeFs(overrides: Partial<Record<'resolve' | 'stat' | 'readText' | 'listDir', unknown>> = {}) {
  return {
    resolve: async (path: string) => target(path),
    stat: async (): Promise<FsInfo> => ({ version: 'v' as FsInfo['version'], type: 'file', size: 4 }),
    readText: async () => 'abcd',
    listDir: async (): Promise<FsDirEntry[]> => [
      { name: 'a.ts', type: 'file', target: target('d/a.ts') },
      { name: 'b', type: 'directory', target: target('d/b') },
      { name: 'c.ts', type: 'file', target: target('d/c.ts') },
    ],
    ...overrides,
  }
}

function fakeContext(fs: unknown): Context {
  return { get: () => fs } as unknown as Context
}

const agent = { session: { header: { cwd: '/w' } } } as unknown as Agent
const bareAgent = { session: { header: {} } } as unknown as Agent
const SIGNAL = new AbortController().signal

function read(span: string): ExtractedCandidate {
  return { op: 'read', span, term: false }
}

describe('stageCandidates', () => {
  it('returns nothing without an fs provider', async () => {
    expect(await stageCandidates({ get: () => undefined } as unknown as Context, agent, BUDGET, [read('x')], SIGNAL)).toEqual([])
  })

  it('stops at an aborted signal', async () => {
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    const entries = await stageCandidates(fakeContext(fakeFs()), agent, BUDGET, [read('x')], controller.signal)
    expect(entries).toEqual([])
  })

  it('skips term and grep candidates', async () => {
    const entries = await stageCandidates(fakeContext(fakeFs()), agent, BUDGET, [
      { op: 'grep', span: 'term', term: true },
    ], SIGNAL)
    expect(entries).toEqual([])
  })

  it('drops absent targets', async () => {
    const entries = await stageCandidates(fakeContext(fakeFs({ stat: async () => undefined })), agent, BUDGET, [read('x')], SIGNAL)
    expect(entries).toEqual([])
  })

  it('drops non-regular files and oversized files', async () => {
    const other = await stageCandidates(fakeContext(fakeFs({
      stat: async (): Promise<FsInfo> => ({ version: 'v' as FsInfo['version'], type: 'other' }),
    })), agent, BUDGET, [read('x')], SIGNAL)
    expect(other).toEqual([])
    const big = await stageCandidates(fakeContext(fakeFs({
      stat: async (): Promise<FsInfo> => ({ version: 'v' as FsInfo['version'], type: 'file', size: 99 }),
    })), agent, BUDGET, [read('x')], SIGNAL)
    expect(big).toEqual([])
    const sizeless = await stageCandidates(fakeContext(fakeFs({
      stat: async (): Promise<FsInfo> => ({ version: 'v' as FsInfo['version'], type: 'file' }),
    })), agent, BUDGET, [read('x')], SIGNAL)
    expect(sizeless.map(entry => entry.path)).toEqual(['x'])
  })

  it('caps content reads at maxFiles and drops provider failures', async () => {
    const two = await stageCandidates(fakeContext(fakeFs()), agent, BUDGET, [read('a'), read('b'), read('c')], SIGNAL)
    expect(two.map(entry => entry.path)).toEqual(['a', 'b'])
    const failing = await stageCandidates(fakeContext(fakeFs({ readText: async () => { throw new Error('io') } })), agent, BUDGET, [read('a')], SIGNAL)
    expect(failing).toEqual([])
  })

  it('caps directory listing lines and counts aggregate bytes', async () => {
    const entries = await stageCandidates(fakeContext(fakeFs({
      stat: async (): Promise<FsInfo> => ({ version: 'v' as FsInfo['version'], type: 'directory' }),
    })), agent, BUDGET, [read('d/')], SIGNAL)
    expect(entries[0]?.kind).toBe('directory')
    expect(entries[0]?.text).toBe('d/a.ts\nd/b/')
  })

  it('resolves without a session cwd header', async () => {
    const entries = await stageCandidates(fakeContext(fakeFs()), bareAgent, BUDGET, [read('x')], SIGNAL)
    expect(entries.map(entry => entry.path)).toEqual(['x'])
  })

  it('applies the aggregate byte ceiling across candidates', async () => {
    const small: StageBudget = { ...BUDGET, maxTotalBytes: 4 }
    const entries = await stageCandidates(fakeContext(fakeFs()), agent, small, [read('a'), read('b')], SIGNAL)
    expect(entries.map(entry => entry.path)).toEqual(['a'])
  })
})
