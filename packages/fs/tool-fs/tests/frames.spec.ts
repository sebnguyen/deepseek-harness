/**
 * The shipped `files` batch faces of `read` and `write`: batch envelope
 * validation, per-element frame settlement (failures settle, later elements
 * still run), abort skip, presenters, and persisted frame meta narrowing.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import type { DiffCallView, DiffResultView } from '@deepseek-ai/dsh-tools'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { parseReadBatch, parseReadElement, readFramesMetaFromMeta, renderReadFrames } from '../src/read.ts'
import { parseWriteBatch, parseWriteElement, renderWriteFrames } from '../src/write.ts'

const testToolSignal = new AbortController().signal

class FakeFs extends FileSystem {
  files = new Map<string, string>()

  override async resolve(path: string): Promise<ReturnType<typeof Object> & object> {
    return { targetKey: FsTargetKey(`key:${path}`), displayPath: `/abs/${path}` } as never
  }
  override processPath(target: { targetKey: string }): string { return String(target.targetKey) }
  override fileUrl(target: { targetKey: string }): string { return `file://${target.targetKey}` }
  override contains(parent: { targetKey: string }, child: { targetKey: string }): boolean {
    return child.targetKey === parent.targetKey || String(child.targetKey).startsWith(`${parent.targetKey}/`)
  }
  override async stat(target: { targetKey: string }): Promise<FsInfo | undefined> {
    const content = this.files.get(target.targetKey)
    if (content === undefined) return undefined
    return { version: FsVersion('v1'), type: 'file', size: content.length }
  }
  override async lstat(path: string): Promise<FsPathInfo | undefined> {
    const content = this.files.get(`key:${path}`)
    if (content === undefined) return undefined
    return { version: FsVersion('v1'), type: 'file', size: content.length }
  }
  override async readText(target: { targetKey: string }): Promise<string> {
    return this.files.get(target.targetKey) ?? ''
  }
  override async streamText(target: { targetKey: string }): Promise<AsyncIterable<string>> {
    const content = this.files.get(target.targetKey) ?? ''
    return (async function* () { yield content })()
  }
  override async readBytes(target: { targetKey: string }, _signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    const bytes = new TextEncoder().encode(this.files.get(target.targetKey) ?? '')
    if (bytes.length > maxBytes) throw new FsError('too large', 'FS_TOO_LARGE')
    return bytes
  }
  override async readByteRange(target: { targetKey: string }, range: { offset: number; length: number }): Promise<Uint8Array> {
    return new TextEncoder().encode(this.files.get(target.targetKey) ?? '').subarray(range.offset, range.offset + range.length)
  }
  override async listDir(): Promise<FsDirEntry[]> { return [] }
  override async writeText(target: { targetKey: string }, content: string, _expected?: FsWriteIntent): Promise<FsWriteOutcome> {
    const before = this.files.get(target.targetKey) ?? null
    this.files.set(target.targetKey, content)
    return { operation: before !== null ? 'update' : 'create', version: FsVersion('v2'), before, after: content }
  }
  override async editText(target: { targetKey: string }, edit: FsEditRequest, _expected?: { version: FsVersion }): Promise<FsEditOutcome> {
    const content = this.files.get(target.targetKey) ?? ''
    const after = content.split(edit.oldString).join(edit.newString)
    this.files.set(target.targetKey, after)
    return { version: FsVersion('v3'), before: content, after }
  }
}

/** A confining backend so the batched write resolves and stamps a standing policy. */
class SandboxingFakeFs extends FakeFs {
  stamped: unknown[] = []
  override get sandboxMode(): SandboxMode { return 'workspace-write' }
  override async writeText(
    target: { targetKey: string }, content: string, expected?: FsWriteIntent,
    _signal?: AbortSignal, sandboxPolicy?: unknown,
  ): Promise<FsWriteOutcome> {
    this.stamped.push(sandboxPolicy)
    return super.writeText(target, content, expected)
  }
}

async function setup(confining = false) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (confining) {
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write' })
    await ctx.plugin(SandboxingFakeFs)
  } else {
    await ctx.plugin(FakeFs)
  }
  await ctx.plugin(ToolFs)
  return { ctx, fs: ctx.fs as FakeFs | SandboxingFakeFs }
}

function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`frames-${Math.random()}`),
    name,
    arguments: args,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('frames registration', () => {
  it('registers the batch faces by default', async () => {
    const { ctx } = await setup()
    const names = ctx.tools.schemas().map(s => s.name).sort()
    expect(names).toEqual(['read', 'write'])
    const read = ctx.tools.schemas().find(s => s.name === 'read')
    expect(JSON.stringify(read?.parameters)).toContain('"files"')
    const write = ctx.tools.schemas().find(s => s.name === 'write')
    expect(JSON.stringify(write?.parameters)).toContain('"files"')
  })

  it('declares batched read parallel-safe and batched write exclusive', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.executionMode({ signal: testToolSignal, callId: ToolCallId('read-frames'), name: 'read', arguments: { files: [{ file_path: 'a.txt' }] } }))
      .toEqual({ kind: 'parallel' })
    expect(ctx.tools.executionMode({ signal: testToolSignal, callId: ToolCallId('write-frames'), name: 'write', arguments: { files: [{ file_path: 'a.txt', content: 'x' }] } }))
      .toEqual({ kind: 'exclusive' })
  })

  it('writes the batch prompt guidance', async () => {
    const { ctx } = await setup()
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('`files` element')
    expect(prompt).toContain('overwrite: true on that element')
  })

  it('advertises the escalation fields on the batched write under a confining backend', async () => {
    const { ctx } = await setup(true)
    const write = ctx.tools.schemas().find(s => s.name === 'write')
    expect(JSON.stringify(write?.parameters)).toContain('sandbox_permissions')
  })

  it('rejects a non-positive maxFilesPerCall at load', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(FakeFs)
    await expect(ctx.plugin(ToolFs, { maxFilesPerCall: 0 })).rejects.toThrow('tool-fs: maxFilesPerCall must be a positive integer')
  })
})

describe('batch envelope validation', () => {
  it('parseReadBatch bounds the element list', () => {
    expect(() => parseReadBatch([], 8)).toThrow('files must contain at least one element')
    expect(() => parseReadBatch(new Array(9).fill({}), 8)).toThrow('files must contain at most 8 elements')
    expect(parseReadBatch([{ file_path: 'a' }], 8)).toHaveLength(1)
  })

  it('parseWriteBatch bounds the element list', () => {
    expect(() => parseWriteBatch([], 8)).toThrow('files must contain at least one element')
    expect(() => parseWriteBatch(new Array(9).fill({}), 8)).toThrow('files must contain at most 8 elements')
    expect(parseWriteBatch([{ file_path: 'a', content: '' }], 8)).toHaveLength(1)
  })

  it('parseReadElement validates paths and caps', () => {
    expect(parseReadElement({ file_path: 'a.txt' }, 5)).toEqual({ filePath: 'a.txt', offset: 1, limit: 5 })
    expect(() => parseReadElement({ file_path: '  ' }, 5)).toThrow('file_path must be a non-empty string')
    expect(() => parseReadElement({ file_path: 'a', offset: 0 }, 5)).toThrow('offset must be a positive integer')
    expect(() => parseReadElement({ file_path: 'a', limit: 6 }, 5)).toThrow('limit must be less than or equal to 5')
  })

  it('parseWriteElement requires a path and one arm', () => {
    expect(parseWriteElement({ file_path: 'a', content: 'x' })).toEqual({ file_path: 'a', content: 'x' })
    expect(parseWriteElement({ file_path: 'a', edits: [] })).toEqual({ file_path: 'a', edits: [] })
    expect(parseWriteElement({ file_path: 'a', content: 'x', overwrite: true, dry_run: true }))
      .toEqual({ file_path: 'a', content: 'x', overwrite: true, dry_run: true })
    expect(() => parseWriteElement({ file_path: '', content: 'x' })).toThrow('file_path must be a non-empty string')
    expect(() => parseWriteElement({ file_path: 'a' })).toThrow('provide content, edits, or both')
  })
})

describe('read frames', () => {
  it('settles every element into its own frame, failures included', async () => {
    const { ctx, fs } = await setup()
    fs.files.set('key:a.txt', 'one\ntwo')
    const result = await call(ctx, 'read', { files: [
      { file_path: 'a.txt' },
      { file_path: 'missing.txt' },
      { file_path: 'a.txt', offset: 2 },
    ] })
    expect(result.isError).toBe(false)
    const body = text(result)
    expect(body).toContain('[1/3] a.txt')
    expect(body).toContain('1: one')
    expect(body).toContain('[2/3] missing.txt')
    expect(body).toContain('[error:')
    expect(body).toContain('2: two')
  })

  it('reports invalid elements as error frames without failing the call', async () => {
    const { ctx } = await setup()
    const definition = ctx.tools.get('read')
    if (definition === undefined) throw new Error('read not registered')
    const value = await definition.execute({ files: [{ file_path: '  ' }, { file_path: 'a.txt' }] }, { signal: testToolSignal } as never) as {
      frames: { file_path: string; kind: string; message?: string }[]
    }
    expect(value.frames[0]).toMatchObject({ file_path: '  ', kind: 'error', message: 'file_path must be a non-empty string' })
  })

  it('rejects an empty batch as a failed call', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, 'read', { files: [] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('files must contain at least one element')
  })

  it('labels skipped elements not-run when the call is aborted', async () => {
    const { ctx } = await setup()
    const definition = ctx.tools.get('read')
    if (definition === undefined) throw new Error('read not registered')
    const aborted = new AbortController()
    aborted.abort()
    const value = await definition.execute({ files: [{ file_path: 'a.txt' }] }, { signal: aborted.signal } as never) as {
      frames: { kind: string; reason?: string }[]
    }
    expect(value.frames).toEqual([{ index: 0, file_path: 'a.txt', kind: 'not-run', reason: 'call aborted' }])
  })

  it('projects successful windows into persisted frame meta', async () => {
    const { ctx, fs } = await setup()
    fs.files.set('key:a.ts', 'const x = 1')
    const result = await call(ctx, 'read', { files: [{ file_path: 'a.ts' }, { file_path: 'missing.ts' }] })
    const meta = (result as { meta?: unknown }).meta as { frames: unknown[] }
    expect(meta.frames).toHaveLength(1)
    const entry = (meta.frames as Record<string, unknown>[])[0]
    expect(entry?.index).toBe(0)
    expect(entry?.path).toBe('/abs/a.ts')
    expect(entry?.lang).toBe('ts')
  })

  it('presentCall titles single and multi batches and lists locations', async () => {
    const { ctx } = await setup()
    const read = ctx.tools.get('read')
    const single = read?.presentCall?.({ files: [{ file_path: 'a.txt', offset: 3 }] })
    expect(single).toEqual({ card: 'generic', title: 'Read a.txt', kind: 'read', locations: [{ path: 'a.txt', line: 3 }] })
    const multi = read?.presentCall?.({ files: [{ file_path: 'a.txt' }, { file_path: 'b.txt' }, { file_path: 'c.txt' }] })
    expect(multi?.title).toBe('3 reads: a.txt')
    expect((multi as { locations?: unknown[] } | undefined)?.locations).toEqual([
      { path: 'a.txt', line: 1 },
      { path: 'b.txt', line: 1 },
      { path: 'c.txt', line: 1 },
    ])
  })
})

describe('readFramesMetaFromMeta', () => {
  it('rejects malformed shapes and admits valid frames', () => {
    expect(readFramesMetaFromMeta(undefined)).toBeUndefined()
    expect(readFramesMetaFromMeta([])).toBeUndefined()
    expect(readFramesMetaFromMeta({})).toBeUndefined()
    expect(readFramesMetaFromMeta({ frames: 'x' })).toBeUndefined()
    expect(readFramesMetaFromMeta({ frames: ['x'] })).toBeUndefined()
    expect(readFramesMetaFromMeta({ frames: [{ index: -1, path: 'p', offset: 1, lines: [], totalLines: 0 }] })).toBeUndefined()
    expect(readFramesMetaFromMeta({ frames: [{ index: '0', path: 'p', offset: 1, lines: [], totalLines: 0 }] })).toBeUndefined()
    expect(readFramesMetaFromMeta({ frames: [{ index: 0, path: 'p', offset: 1, lines: [], totalLines: 0 }] }))
      .toEqual({ frames: [{ index: 0, path: 'p', offset: 1, lines: [], totalLines: 0 }] })
  })
})

describe('renderReadFrames', () => {
  it('renders error and not-run markers alongside read envelopes', () => {
    const body = renderReadFrames([
      { index: 0, file_path: 'a', kind: 'error', message: 'boom' },
      { index: 1, file_path: 'b', kind: 'not-run', reason: 'call aborted' },
      { index: 2, file_path: 'c', kind: 'read', path: 'c', offset: 1, lines: [{ number: 1, text: 'x' }], totalLines: 1 },
    ])
    expect(body).toContain('[1/3] a\n[error: boom]')
    expect(body).toContain('[2/3] b\n[not run: call aborted]')
    expect(body).toContain('[3/3] c')
    expect(body).toContain('1: x')
  })
})

describe('write frames', () => {
  it('commits each element atomically and lets later elements run after a failure', async () => {
    const { ctx, fs } = await setup()
    fs.files.set('key:existing.txt', 'untouched')
    const result = await call(ctx, 'write', { files: [
      { file_path: 'new.txt', content: 'fresh\n' },
      { file_path: 'existing.txt', content: 'clobber' },
      { file_path: 'after.txt', content: 'later\n' },
    ] })
    expect(result.isError).toBe(false)
    const body = text(result)
    expect(body).toContain('[1/3] new.txt')
    expect(body).toContain('Created file')
    expect(body).toContain('[2/3] existing.txt')
    expect(body).toContain('cannot overwrite')
    expect(body).toContain('[3/3] after.txt')
    expect(fs.files.get('key:new.txt')).toBe('fresh\n')
    expect(fs.files.get('key:existing.txt')).toBe('untouched')
    expect(fs.files.get('key:after.txt')).toBe('later\n')
  })

  it('applies per-element programs against earlier committed results', async () => {
    const { ctx, fs } = await setup()
    const result = await call(ctx, 'write', { files: [
      { file_path: 'doc.txt', content: 'alpha\n' },
      { file_path: 'doc.txt', edits: [{ old_string: 'alpha', new_string: 'beta' }] },
    ] })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('1 edits applied (1 matches)')
    expect(fs.files.get('key:doc.txt')).toBe('beta\n')
  })

  it('previews one element without committing while siblings commit', async () => {
    const { ctx, fs } = await setup()
    const result = await call(ctx, 'write', { files: [
      { file_path: 'draft.txt', content: 'draft\n', dry_run: true },
      { file_path: 'real.txt', content: 'real\n' },
    ] })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('Dry run — no commit. 0 entries would apply.')
    expect(fs.files.get('key:draft.txt')).toBeUndefined()
    expect(fs.files.get('key:real.txt')).toBe('real\n')
  })

  it('settles invalid elements as error frames', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, 'write', { files: [{ file_path: 'a' }] })
    expect(result.isError).toBe(false)
    expect(text(result)).toContain('[1/1] a')
    expect(text(result)).toContain('provide content, edits, or both')
  })

  it('labels skipped elements not-run when the call is aborted', async () => {
    const { ctx } = await setup()
    const definition = ctx.tools.get('write')
    if (definition === undefined) throw new Error('write not registered')
    const aborted = new AbortController()
    aborted.abort()
    const value = await definition.execute(
      { files: [{ file_path: 'a.txt', content: 'x' }] },
      { signal: aborted.signal } as never,
    ) as { frames: { kind: string }[] }
    expect(value.frames[0]?.kind).toBe('not-run')
  })

  it('stamps the standing sandbox policy onto batched commits', async () => {
    const { ctx, fs } = await setup(true)
    const result = await call(ctx, 'write', { files: [{ file_path: 'locked.txt', content: 'x\n' }] })
    expect(result.isError).toBe(false)
    expect((fs as SandboxingFakeFs).stamped).toEqual([expect.objectContaining({ mode: 'workspace-write' })])
  })

  it('persists per-frame diffs for committed elements only', async () => {
    const { ctx, fs } = await setup()
    fs.files.set('key:known.txt', 'old')
    // observe so the update commits
    await call(ctx, 'read', { files: [{ file_path: 'known.txt' }] })
    const result = await call(ctx, 'write', { files: [
      { file_path: 'known.txt', edits: [{ old_string: 'old', new_string: 'new' }] },
      { file_path: 'fresh.txt', content: 'brand new' },
    ] })
    const frames = ((result as { meta?: unknown }).meta as { frames: { index: number; diffs: unknown[] }[] }).frames
    expect(frames.map(frame => frame.index)).toEqual([0])
    expect(frames[0]?.diffs.length).toBeGreaterThan(0)
  })

  it('presentCall renders single and multi diff cards', async () => {
    const { ctx } = await setup()
    const write = ctx.tools.get('write')
    const single = write?.presentCall?.({ files: [{ file_path: 'a.txt', content: 'x' }] }) as DiffCallView | undefined
    expect(single?.title).toBe('Write a.txt')
    const patch = write?.presentCall?.({ files: [{ file_path: 'a.txt', edits: [{ old_string: 'x', new_string: 'y' }] }] }) as DiffCallView | undefined
    expect(patch?.title).toBe('Patch a.txt')
    const multi = write?.presentCall?.({ files: [{ file_path: 'a.txt', content: 'x' }, { file_path: 'b.txt', content: 'y' }] }) as DiffCallView | undefined
    expect(multi?.title).toBe('2 writes: a.txt')
    expect(multi?.diffs).toHaveLength(2)
  })

  it('presentResult falls back to args-derived diffs when meta is absent', async () => {
    const { ctx } = await setup()
    const write = ctx.tools.get('write')
    const view = write?.presentResult?.(
      { files: [{ file_path: 'a.txt', content: 'x' }] },
      { content: [{ type: 'text' as const, text: 'ok' }], isError: false },
    ) as DiffResultView | undefined
    expect(view?.diffs).toEqual([{ path: 'a.txt', oldText: null, newText: 'x' }])
    expect(write?.presentResult?.({ files: [{ file_path: 'a.txt', content: 'x' }] }, { content: [], isError: true }))
      .toBeUndefined()
  })
})

describe('renderWriteFrames', () => {
  it('renders commit, preview, error, and not-run sections', () => {
    const body = renderWriteFrames([
      { index: 0, file_path: 'a', kind: 'written', path: 'a', before: null, after: 'x', committed: true, outcomes: [] },
      { index: 1, file_path: 'b', kind: 'written', path: 'b', before: 'y', after: 'z', committed: false, outcomes: [{ index: 0, kind: 'literal', matches: 2 }] },
      { index: 2, file_path: 'c', kind: 'error', message: 'denied' },
      { index: 3, file_path: 'd', kind: 'not-run', reason: 'call aborted' },
    ])
    expect(body).toContain('[1/4] a')
    expect(body).toContain('Created file')
    expect(body).toContain('Dry run — no commit. 1 entry would apply.')
    expect(body).toContain('[3/4] c\n[error: denied]')
    expect(body).toContain('[4/4] d\n[not run: call aborted]')
  })
})
