/**
 * End-to-end tool-registry tests against the real local backend. The default deployment verifies
 * the tool-owned gate (explicit overwrite flag, fresh program basis, observed-state CAS) and the
 * sed-style program arm; the strict deployment proves a loaded fs-observation-policy still owns
 * the intent slot first. Assertions read files back byte-for-byte rather than trusting tool
 * messages.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as FsPolicy from '@deepseek-ai/dsh-fs-observation-policy'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'

const testToolSignal = new AbortController().signal

let dir: string
let ctx: Context
let fiber: Awaited<ReturnType<Context['plugin']>>
// No header cwd: sessionCwd returns undefined and the provider's configured test dir applies.
const session = { header: {} }

let callCounter = 0
function call(name: string, args: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
    agent: { session } as never,
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

function overwriteDeniedDiagnostic(path: string): string {
  return `Error: cannot overwrite "${path}": not read this session — read it first, or pass overwrite: true`
}

afterEach(async () => {
  await fiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

// --------------------------------------------------------------------------
// DEFAULT deployment: the tool-owned gate, no policy plugin.
// --------------------------------------------------------------------------
describe('default deployment (tool-owned gate)', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-tool-fs-'))
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    fiber = await ctx.plugin(ToolFs)
  })

  describe('content arm → disk', () => {
    it('creates a file with exactly the requested bytes', async () => {
      const result = await call('write', { file_path: 'new.txt', content: 'line one\nline two\n' })
      expect(result.isError).toBe(false)
      expect(await readFile(join(dir, 'new.txt'), 'utf8')).toBe('line one\nline two\n')
    })

    it('rejects overwriting an existing unread file with the explicit-flag remedy', async () => {
      await writeFile(join(dir, 'a.txt'), 'original')
      const result = await call('write', { file_path: 'a.txt', content: 'clobber' })
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'FS_OVERWRITE_DENIED' } })
      expect(text(result)).toBe(overwriteDeniedDiagnostic(join(dir, 'a.txt')))
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('original')
    })

    it('overwrite: true replaces an unread existing file', async () => {
      await writeFile(join(dir, 'a.txt'), 'original')
      const result = await call('write', { file_path: 'a.txt', content: 'clobbered', overwrite: true })
      expect(result.isError).toBe(false)
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('clobbered')
    })

    it('allows overwriting after a read, without the flag', async () => {
      await writeFile(join(dir, 'a.txt'), 'original')
      expect((await call('read', { file_path: 'a.txt' })).isError).toBe(false)
      const result = await call('write', { file_path: 'a.txt', content: 'replaced' })
      expect(result.isError).toBe(false)
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('replaced')
    })

    it('rejects a full overwrite when the file changed since the read (stale)', async () => {
      await writeFile(join(dir, 'a.txt'), 'original')
      await call('read', { file_path: 'a.txt' })
      await writeFile(join(dir, 'a.txt'), 'changed-externally') // out-of-band change
      const result = await call('write', { file_path: 'a.txt', content: 'replaced' })
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'FS_STALE_VERSION' } })
      expect(text(result)).toContain('file changed since it was read')
      expect(text(result)).toContain('re-read the file, then retry')
    })

    it('the overwrite flag does not weaken the observed-version CAS', async () => {
      await writeFile(join(dir, 'a.txt'), 'original')
      expect((await call('read', { file_path: 'a.txt' })).isError).toBe(false)
      await writeFile(join(dir, 'a.txt'), 'changed-externally')
      const result = await call('write', { file_path: 'a.txt', content: 'clobber', overwrite: true })
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'FS_STALE_VERSION' } })
    })
  })

  describe('program arm (sed-style entries) → disk', () => {
    it('applies a unique literal hunk with NO prior read', async () => {
      await writeFile(join(dir, 'a.txt'), 'hello world')
      const result = await call('write', { file_path: 'a.txt', edits: [{ old_string: 'world', new_string: 'there' }] })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('1 edits applied (1 matches)')
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('hello there')
    })

    it('reports a missing target as FS_NOT_FOUND', async () => {
      const result = await call('write', { file_path: 'missing.txt', edits: [{ old_string: 'a', new_string: 'b' }] })
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'FS_NOT_FOUND' } })
    })

    it('replace_all replaces every match', async () => {
      await writeFile(join(dir, 'a.txt'), 'a a a')
      const result = await call('write', { file_path: 'a.txt', edits: [{ old_string: 'a', new_string: 'b', replace_all: true }] })
      expect(result.isError).toBe(false)
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('b b b')
    })

    it('regex entries honor $1 group references', async () => {
      await writeFile(join(dir, 'a.txt'), 'lat 40 ms\n')
      const result = await call('write', { file_path: 'a.txt', edits: [{ pattern: '(\\d+) ms', new_string: '$1ms' }] })
      expect(result.isError).toBe(false)
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('lat 40ms\n')
    })

    it('line ranges replace and delete; inserts land after the named line', async () => {
      await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\nfour')
      const result = await call('write', {
        file_path: 'a.txt',
        edits: [
          { after_line: 0, new_string: '# head' },
          { first_line: 3, last_line: 4, new_string: 'TWO+THREE' },
          { first_line: 4, last_line: 4, new_string: '' },
        ],
      })
      expect(result.isError).toBe(false)
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('# head\none\nTWO+THREE')
    })

    it('sequential entries: later hunks address earlier results', async () => {
      await writeFile(join(dir, 'a.txt'), 'alpha beta')
      const result = await call('write', {
        file_path: 'a.txt',
        edits: [
          { old_string: 'alpha', new_string: 'ALPHA' },
          { old_string: 'ALPHA beta', new_string: 'OMEGA' },
        ],
      })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('2 edits applied')
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('OMEGA')
    })

    it('a failing later entry commits nothing (all-or-nothing)', async () => {
      await writeFile(join(dir, 'a.txt'), 'alpha beta')
      const result = await call('write', {
        file_path: 'a.txt',
        edits: [
          { old_string: 'alpha', new_string: 'ALPHA' },
          { old_string: 'absent', new_string: 'x' },
        ],
      })
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'FS_EDIT_NOT_FOUND' } })
      expect(text(result)).toContain('edits[1]')
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('alpha beta')
    })

    it('content plus edits seeds then patches in one commit', async () => {
      const result = await call('write', { file_path: 'a.txt', content: 'alpha beta', edits: [{ old_string: 'beta', new_string: 'BETA' }] })
      expect(result.isError).toBe(false)
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('alpha BETA')
    })

    it('dry_run reports counts and would-be text without touching disk', async () => {
      await writeFile(join(dir, 'a.txt'), 'alpha beta')
      const result = await call('write', {
        file_path: 'a.txt',
        edits: [{ old_string: 'alpha', new_string: 'ALPHA' }],
        dry_run: true,
      })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('Dry run — no commit.')
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('alpha beta')
    })

    it('a write→program cycle needs no intervening read', async () => {
      await call('write', { file_path: 'a.txt', content: 'one two' })
      const result = await call('write', { file_path: 'a.txt', edits: [{ old_string: 'two', new_string: 'three' }] })
      expect(result.isError).toBe(false)
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('one three')
    })

    it('editing does not authorize a clobbering content write', async () => {
      await writeFile(join(dir, 'a.txt'), 'hello world')
      await writeFile(join(dir, 'b.txt'), 'unseen')
      expect((await call('write', { file_path: 'a.txt', edits: [{ old_string: 'world', new_string: 'there' }] })).isError).toBe(false)
      const write = await call('write', { file_path: 'b.txt', content: 'x' })
      expect(write.isError).toBe(true)
      expect(write.error).toMatchObject({ info: { code: 'FS_OVERWRITE_DENIED' } })
    })
  })

  describe('read', () => {
    it('returns line-numbered content', async () => {
      await writeFile(join(dir, 'a.txt'), 'alpha\nbeta')
      const result = await call('read', { file_path: 'a.txt' })
      expect(text(result)).toContain('1: alpha')
      expect(text(result)).toContain('2: beta')
      expect(text(result)).toContain('(End of file - total 2 lines)')
    })

    it('reports a binary file as an error', async () => {
      await writeFile(join(dir, 'bin'), Buffer.from([0x00, 0x01, 0x02]))
      const result = await call('read', { file_path: 'bin' })
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'FS_NOT_TEXT' } })
    })

    it('paginates a multi-line file with offset/limit', async () => {
      await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\nfour')
      const result = await call('read', { file_path: 'a.txt', offset: 2, limit: 2 })
      expect(text(result)).toContain('2: two')
      expect(text(result)).toContain('3: three')
      expect(text(result)).toContain('(Showing lines 2-3 of 4. Use offset=4 to continue.)')
    })
  })

  describe('the gate records only through the events (no method coupling)', () => {
    it('a direct ctx.fs.readText records no observed-state, so a later content write still denies', async () => {
      await writeFile(join(dir, 'a.txt'), 'hello world')
      await ctx.fs.readText(await ctx.fs.resolve('a.txt'))
      const result = await call('write', { file_path: 'a.txt', content: 'x' })
      expect(result.isError).toBe(true)
      expect(result.error).toMatchObject({ info: { code: 'FS_OVERWRITE_DENIED' } })
    })
  })

  describe('deleted observed target', () => {
    it('a failed reread records absence so write can safely recreate the file', async () => {
      await writeFile(join(dir, 'a.txt'), 'original')
      await call('read', { file_path: 'a.txt' })
      await rm(join(dir, 'a.txt')) // out-of-band deletion

      const write = await call('write', { file_path: 'a.txt', content: 'premature' })
      expect(write.isError).toBe(true)
      expect(write.error).toMatchObject({ info: { code: 'FS_STALE_VERSION' } })

      const reread = await call('read', { file_path: 'a.txt' })
      expect(reread.isError).toBe(true)
      expect(reread.error).toMatchObject({ info: { code: 'FS_NOT_FOUND' } })

      const retriedProgram = await call('write', { file_path: 'a.txt', edits: [{ old_string: 'original', new_string: 'x' }] })
      expect(retriedProgram.isError).toBe(true)
      expect(retriedProgram.error).toMatchObject({ info: { code: 'FS_NOT_FOUND' } })

      const recovered = await call('write', { file_path: 'a.txt', content: 'fresh' })
      expect(recovered.isError).toBe(false)
      expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('fresh')
    })
  })

  describe('stat budget', () => {
    it('observed writes need no stat; unobserved content stats once; programs stat once', async () => {
      await writeFile(join(dir, 'a.txt'), 'hello world')
      const statSpy = vi.spyOn(ctx.fs, 'stat')

      await call('read', { file_path: 'a.txt' })
      expect(statSpy).toHaveBeenCalledTimes(1)

      statSpy.mockClear()
      const written = await call('write', { file_path: 'a.txt', content: 'fresh' })
      expect(written.isError).toBe(false)
      expect(statSpy).not.toHaveBeenCalled()

      statSpy.mockClear()
      // a.txt is observed by the write above: the program arm needs no stat.
      const patched = await call('write', { file_path: 'a.txt', edits: [{ old_string: 'fresh', new_string: 'newer' }] })
      expect(patched.isError).toBe(false)
      expect(statSpy).not.toHaveBeenCalled()

      await writeFile(join(dir, 'b.txt'), 'unseen')
      statSpy.mockClear()
      const denied = await call('write', { file_path: 'b.txt', content: 'x' })
      expect(denied.isError).toBe(true)
      expect(statSpy).toHaveBeenCalledTimes(1)
      statSpy.mockRestore()
    })

    it('a missing read still stats once and its recovery write stats zero times', async () => {
      const statSpy = vi.spyOn(ctx.fs, 'stat')
      const missing = await call('read', { file_path: 'missing.txt' })
      expect(missing.isError).toBe(true)
      expect(missing.error).toMatchObject({ info: { code: 'FS_NOT_FOUND' } })
      expect(statSpy).toHaveBeenCalledTimes(1)

      statSpy.mockClear()
      const created = await call('write', { file_path: 'missing.txt', content: 'fresh' })
      expect(created.isError).toBe(false)
      expect(statSpy).not.toHaveBeenCalled()
      statSpy.mockRestore()
    })
  })
})

// --------------------------------------------------------------------------
// STRICT deployment: fs-observation-policy loaded on top of the default.
// --------------------------------------------------------------------------
describe('strict deployment (fs-observation-policy loaded)', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-tool-fs-strict-'))
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(FsPolicy)
    fiber = await ctx.plugin(ToolFs)
  })

  it('a content write without a prior read still rejects with FS_NOT_OBSERVED', async () => {
    await writeFile(join(dir, 'a.txt'), 'original')
    const result = await call('write', { file_path: 'a.txt', content: 'clobber' })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('original')
  })

  it('a program without a prior read rejects with FS_NOT_OBSERVED', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello world')
    const result = await call('write', { file_path: 'a.txt', edits: [{ old_string: 'world', new_string: 'there' }] })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('hello world')
  })

  it('the overwrite flag does NOT bypass a loaded strict policy', async () => {
    await writeFile(join(dir, 'a.txt'), 'original')
    const result = await call('write', { file_path: 'a.txt', content: 'clobber', overwrite: true })
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'FS_NOT_OBSERVED' } })
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('original')
  })

  it('read-then-program and read-then-write keep working', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello world')
    expect((await call('read', { file_path: 'a.txt' })).isError).toBe(false)
    expect((await call('write', { file_path: 'a.txt', edits: [{ old_string: 'world', new_string: 'there' }] })).isError).toBe(false)
    expect((await call('write', { file_path: 'a.txt', content: 'final' })).isError).toBe(false)
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('final')
  })

  it('a stale observation fails closed at the policy-owned CAS', async () => {
    await writeFile(join(dir, 'a.txt'), 'older content\n')
    const target = await ctx.fs.resolve('a.txt')
    const firstInfo = await ctx.fs.stat(target)
    if (!firstInfo) throw new Error('expected first stat')
    expect((await call('read', { file_path: 'a.txt' })).isError).toBe(false)
    await writeFile(join(dir, 'a.txt'), 'newer current content\n')
    ctx.emit('fs/observed', target, { kind: 'present', version: firstInfo.version }, { agent: { session } })
    const edit = await call('write', { file_path: 'a.txt', edits: [{ old_string: 'newer', new_string: 'edited' }] })
    expect(edit.isError).toBe(true)
    expect(edit.error).toMatchObject({ info: { code: 'FS_STALE_VERSION' } })
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('newer current content\n')
  })

  it('a program against a confirmed-absent target reports FS_NOT_FOUND', async () => {
    const reread = await call('read', { file_path: 'gone.txt' })
    expect(reread.isError).toBe(true)
    const program = await call('write', { file_path: 'gone.txt', edits: [{ old_string: 'x', new_string: 'y' }] })
    expect(program.isError).toBe(true)
    expect(program.error).toMatchObject({ info: { code: 'FS_NOT_FOUND' } })
  })
})

// Per-session cwd: a relative file_path resolves against the calling session's workspace
// (`exec.agent.session.header.cwd`), not the backend's config.cwd, so the
// caller-selected session workspace wins, matching dsh-tool-bash.
describe('per-session cwd', () => {
  let sessionDir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-tool-fs-cfg-'))
    sessionDir = await mkdtemp(join(tmpdir(), 'dsh-tool-fs-session-'))
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir }) // config.cwd = dir, NOT sessionDir
    fiber = await ctx.plugin(ToolFs)
  })
  afterEach(async () => { await rm(sessionDir, { recursive: true, force: true }) })

  const callIn = (sessionObj: object, name: string, args: unknown) =>
    ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId(`call-${++callCounter}`),
      name,
      arguments: args,
      agent: { session: sessionObj } as never,
    })

  it('writes a relative path into the SESSION cwd, not config.cwd', async () => {
    const result = await callIn({ header: { cwd: sessionDir } }, 'write', { file_path: 'note.txt', content: 'hi' })
    expect(result.isError).toBe(false)
    expect(await readFile(join(sessionDir, 'note.txt'), 'utf8')).toBe('hi')
    await expect(readFile(join(dir, 'note.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('read + program both resolve against the session cwd (end-to-end)', async () => {
    const owned = { header: { cwd: sessionDir } }
    await writeFile(join(sessionDir, 'code.txt'), 'alpha')
    expect((await callIn(owned, 'read', { file_path: 'code.txt' })).isError).toBe(false)
    const edited = await callIn(owned, 'write', { file_path: 'code.txt', edits: [{ old_string: 'alpha', new_string: 'beta' }] })
    expect(edited.isError).toBe(false)
    expect(await readFile(join(sessionDir, 'code.txt'), 'utf8')).toBe('beta')
  })

  it('observed state keys by owner: another session still sees the file as unread', async () => {
    const one = { header: { cwd: sessionDir } }
    const two = { header: { cwd: sessionDir } }
    await writeFile(join(sessionDir, 'code.txt'), 'alpha')
    expect((await callIn(one, 'read', { file_path: 'code.txt' })).isError).toBe(false)
    const foreign = await callIn(two, 'write', { file_path: 'code.txt', content: 'clobber' })
    expect(foreign.isError).toBe(true)
    expect(foreign.error).toMatchObject({ info: { code: 'FS_OVERWRITE_DENIED' } })
  })
})

// --------------------------------------------------------------------------
// Abort-through-the-tool and tool-tier concurrency against the REAL backend.
// --------------------------------------------------------------------------
describe('signal and concurrency', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-tool-fs-'))
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    fiber = await ctx.plugin(ToolFs)
  })

  const callSig = (signal: AbortSignal, name: string, args: unknown) =>
    ctx.tools.execute({ callId: ToolCallId(`c-${++callCounter}`), name, arguments: args, agent: { session } as never, signal })
  const callOwned = (name: string, args: unknown) =>
    ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId(`c-${++callCounter}`), name, arguments: args, agent: { session } as never })

  it('a pre-aborted registry call skips read/write-content/write-program with ABORTED_BEFORE_DISPATCH', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello')
    const read = await callSig(AbortSignal.abort(), 'read', { file_path: 'a.txt' })
    expect(read.isError).toBe(true)
    expect(read.error).toMatchObject({ info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } })

    const write = await callSig(AbortSignal.abort(), 'write', { file_path: 'new.txt', content: 'x' })
    expect(write.isError).toBe(true)
    expect(write.error).toMatchObject({ info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } })
    await expect(readFile(join(dir, 'new.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const program = await callSig(AbortSignal.abort(), 'write', { file_path: 'a.txt', edits: [{ old_string: 'hello', new_string: 'bye' }] })
    expect(program.isError).toBe(true)
    expect(program.error).toMatchObject({ info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } })
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('hello') // unchanged
  })

  it('two concurrent content writes after one read: one wins, one FS_STALE_VERSION', async () => {
    await writeFile(join(dir, 'a.txt'), 'base value here')
    expect((await callOwned('read', { file_path: 'a.txt' })).isError).toBe(false)
    const [one, two] = await Promise.all([
      callOwned('write', { file_path: 'a.txt', content: 'ONE' }),
      callOwned('write', { file_path: 'a.txt', content: 'TWO' }),
    ])
    const errors = [one, two].filter(r => r.isError)
    expect(errors).toHaveLength(1)
    expect(errors[0]?.error).toMatchObject({ info: { code: 'FS_STALE_VERSION' } })
    const onDisk = await readFile(join(dir, 'a.txt'), 'utf8')
    expect(onDisk === 'ONE' || onDisk === 'TWO').toBe(true)
  })

  it('a throwing fs/observed listener surfaces as isError, but the mutation already hit disk', async () => {
    ctx.on('fs/observed', () => { throw new Error('recording bug') })
    const result = await callOwned('write', { file_path: 'w.txt', content: 'durable' })
    expect(result.isError).toBe(true)
    expect(await readFile(join(dir, 'w.txt'), 'utf8')).toBe('durable')
  })
})
