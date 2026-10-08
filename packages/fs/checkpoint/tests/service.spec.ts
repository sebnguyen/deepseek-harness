/** Covers write-file capture, the slot register, restore, and disposal. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId, SessionStore, type Session } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { PURPOSE_KEY, defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CheckpointService, { digestOf, CheckpointStore } from '../src/index.ts'
import type { CheckpointRow } from '../src/types.ts'

const SIGNAL = new AbortController().signal

/** One mounted capture stack: a workspace, a session, and the rows read back from the log. */
interface Harness {
  readonly ctx: Context
  readonly session: Session
  readonly agent: Agent
  readonly root: string
  readonly home: string
  rows(): CheckpointRow[]
  run(name: string, callId: string, args: Record<string, unknown>): Promise<void>
}

/** Mount the capture stack over a fresh temp workspace and a fresh session store. */
async function harness(options: {
  enabled?: boolean
  home?: string
  sessionId?: string
  root?: string
  maxLabelBytes?: number
  maxRetainedBytes?: number
} = {}): Promise<Harness> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'dsh-checkpoint-ws-'))
  const home = options.home ?? await mkdtemp(join(tmpdir(), 'dsh-checkpoint-home-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(CheckpointService, {
    enabled: options.enabled ?? true,
    dshHome: home,
    maxLabelBytes: options.maxLabelBytes ?? 8192,
    maxRetainedBytes: options.maxRetainedBytes ?? 8192,
  })
  const session = ctx.sessions.create(SessionId(options.sessionId ?? 's1'), { meta: { cwd: root } })
  const agent = { session } as unknown as Agent
  ctx.tools.register(defineTool({
    name: 'writer',
    description: 'write a.txt with the given content',
    parameters: { content: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args, exec) => {
      const content = String(args.content)
      let before: string | null
      try {
        before = await readFile(join(root, 'a.txt'), 'utf8')
      } catch {
        // a.txt is absent until the first write in this workspace
        before = null
      }
      await writeFile(join(root, 'a.txt'), content, 'utf8')
      await ctx.get('checkpoint')?.captureWrite(exec, { path: 'a.txt', before, after: content })
      return 'written'
    },
  }))
  ctx.tools.register(defineTool({
    name: 'remover',
    description: 'delete a.txt',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async () => {
      await rm(join(root, 'a.txt'))
      return 'removed'
    },
  }))
  ctx.tools.register(defineTool({
    name: 'noop',
    description: 'leave the workspace untouched',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async () => 'noop',
  }))
  const rows = (): CheckpointRow[] => {
    const collected: CheckpointRow[] = []
    for (const event of session.snapshotEvents()) {
      if (event.type === 'checkpoint/scan') collected.push(...event.data.rows)
    }
    return collected
  }
  return {
    ctx,
    session,
    agent,
    root,
    home,
    rows,
    run: async (name, callId, args) => {
      await ctx.tools.execute({ signal: SIGNAL, callId: ToolCallId(callId), name, arguments: args, agent })
    },
  }
}

describe('checkpoint capture', () => {
  it('records one attributed row per changed file and chains before digests', async () => {
    const stack = await harness()
    await stack.run('writer', 'c1', { content: 'one', [PURPOSE_KEY]: 'first write' })
    expect(stack.rows()).toEqual([
      { path: 'a.txt', callId: 'c1', toolName: 'writer', purpose: 'first write', after: digestOf('one') },
    ])

    await stack.run('writer', 'c2', { content: 'two' })
    expect(stack.rows()[1]).toEqual({
      path: 'a.txt', callId: 'c2', toolName: 'writer', before: digestOf('one'), after: digestOf('two'),
    })
  })

  it('records nothing for a delete the write tool did not hand over', async () => {
    const stack = await harness()
    await stack.run('writer', 'c1', { content: 'one' })
    await stack.run('remover', 'c2', {})
    expect(stack.rows()).toHaveLength(1)
  })

  it('appends nothing when a call does not hand over a file', async () => {
    const stack = await harness()
    await writeFile(join(stack.root, 'a.txt'), 'one', 'utf8')
    await stack.run('noop', 'c1', {})
    expect(stack.rows()).toEqual([])
  })

  it('captures nothing without an owning agent', async () => {
    const stack = await harness()
    await stack.ctx.tools.execute({
      signal: SIGNAL, callId: ToolCallId('c1'), name: 'writer', arguments: { content: 'one' },
    })
    expect(stack.rows()).toEqual([])
  })

  it('captures nothing when disabled', async () => {
    const stack = await harness({ enabled: false })
    await stack.run('writer', 'c1', { content: 'one' })
    expect(stack.rows()).toEqual([])
  })

  it('chains before from the text the next write reads, including in a new process', async () => {
    const first = await harness({ sessionId: 'resumed' })
    await first.run('writer', 'c1', { content: 'one' })
    const second = await harness({ home: first.home, sessionId: 'resumed', root: first.root })
    await second.run('writer', 'c2', { content: 'two!' })
    expect(second.rows()).toEqual([
      { path: 'a.txt', callId: 'c2', toolName: 'writer', before: digestOf('one'), after: digestOf('two!') },
    ])
  })

  it('records nothing when the object store cannot retain the bytes', async () => {
    const stack = await harness()
    await chmod(stack.home, 0)
    try {
      await stack.run('writer', 'c1', { content: 'one' })
      expect(stack.rows()).toEqual([])
    } finally {
      await chmod(stack.home, 0o700)
    }
  })
})

describe('checkpoint slot register', () => {
  it('writes a note slot and lists it under its path with its retained blob', async () => {
    const stack = await harness()
    const service = stack.ctx.get('checkpoint') as CheckpointService
    const slot = await service.putSlot(stack.session, {
      slotId: 'note-abc',
      kind: 'note',
      path: 'src/a.ts',
      label: 'this 401 should be a 403',
      line: 7,
      retained: 'throw new Error(401)',
      detail: { text: 'this 401 should be a 403' },
    })
    // The merged detail map is the wire payload union; the note member carries the text.
    expect(slot.after).toBe(digestOf('throw new Error(401)'))
    expect(slot.createdAt).toBeGreaterThan(0)
    const [timeline] = await service.slots(stack.session)
    expect(timeline?.path).toBe('src/a.ts')
    expect(timeline?.slots.map(entry => ({
      slotId: entry.slotId, kind: entry.kind, line: entry.line, label: entry.label, after: entry.after,
      turn: entry.turn, detail: entry.detail,
    }))).toEqual([{
      slotId: 'note-abc', kind: 'note', line: 7, label: 'this 401 should be a 403',
      after: digestOf('throw new Error(401)'), turn: undefined,
      detail: { text: 'this 401 should be a 403' },
    }])
    expect(await service.blob(stack.session, digestOf('throw new Error(401)'))).toBe('throw new Error(401)')
  })

  it('mints worktree slots from captureWrite with slotId equal to the call id', async () => {
    const stack = await harness()
    stack.session.append('tool/call', {
      turn: 2, step: 0, callId: ToolCallId('c1'), name: 'writer', arguments: '{}', purpose: 'stated',
    })
    await stack.run('writer', 'c1', { content: 'one', [PURPOSE_KEY]: 'stated' })
    const service = stack.ctx.get('checkpoint') as CheckpointService
    const [timeline] = await service.slots(stack.session)
    expect(timeline?.slots).toEqual([{
      slotId: 'c1', kind: 'worktree', path: 'a.txt', label: 'stated', turn: 2, callId: 'c1',
      after: digestOf('one'), createdAt: expect.any(Number), detail: { toolName: 'writer' },
    }])

    // The register is keyed per session: a different session under the same
    // home sees none of this one's slots.
    const other = await harness({ home: stack.home, root: stack.root, sessionId: 'other' })
    expect(await (other.ctx.get('checkpoint') as CheckpointService).slots(other.session)).toEqual([])
  })

  it('keeps the register readable across a host restart for the same session', async () => {
    const first = await harness({ sessionId: 'resumed' })
    await first.run('writer', 'c1', { content: 'one' })
    const second = await harness({ home: first.home, sessionId: 'resumed', root: first.root })
    const service = second.ctx.get('checkpoint') as CheckpointService
    const [timeline] = await service.slots(second.session)
    expect(timeline?.slots.map(entry => ({ slotId: entry.slotId, kind: entry.kind })))
      .toEqual([{ slotId: 'c1', kind: 'worktree' }])
  })

  it('rejects puts whose label or retained text exceed the configured bounds', async () => {
    const stack = await harness({ maxLabelBytes: 4, maxRetainedBytes: 4 })
    const service = stack.ctx.get('checkpoint') as CheckpointService
    await expect(service.putSlot(stack.session, {
      slotId: 'n1', kind: 'note', path: 'a.txt', label: 'too long', detail: { text: 'too long' },
    })).rejects.toThrow(/label exceeds/)
    await expect(service.putSlot(stack.session, {
      slotId: 'n1', kind: 'note', path: 'a.txt', label: 'ok', retained: 'way too long', detail: { text: 'ok' },
    })).rejects.toThrow(/retained text exceeds/)
    expect(await service.slots(stack.session)).toEqual([])
  })

  it('rejects a duplicate slotId and appends release tombstones as the only hide', async () => {
    const stack = await harness()
    const service = stack.ctx.get('checkpoint') as CheckpointService
    await service.putSlot(stack.session, { slotId: 'n1', kind: 'note', path: 'a.txt', label: 'x', detail: { text: 'x' } })
    await expect(service.putSlot(stack.session, { slotId: 'n1', kind: 'note', path: 'a.txt', label: 'x', detail: { text: 'x' } }))
      .rejects.toThrow(/already exists/)

    // Releasing an absent slot is a redundant tombstone, not an error.
    await service.releaseSlot(stack.session, 'absent')
    await service.releaseSlot(stack.session, 'n1')
    await service.releaseSlot(stack.session, 'n1')
    expect(await service.slots(stack.session)).toEqual([])

    const store = new CheckpointStore(join(stack.home, 'checkpoints', 'v1', 's1'))
    const rows = await store.loadSlotRows()
    expect(rows).toEqual([
      { slotId: 'n1', kind: 'note', path: 'a.txt', label: 'x', createdAt: expect.any(Number), detail: { text: 'x' } },
      { slotId: 'absent', released: true },
      { slotId: 'n1', released: true },
      { slotId: 'n1', released: true },
    ])
  })

  it('recovers the readable prefix of a hand-corrupted register log', async () => {
    const stack = await harness()
    const dir = join(stack.home, 'checkpoints', 'v1', 's1')
    await mkdir(dir, { recursive: true })
    await appendFile(join(dir, 'slots.jsonl'), [
      JSON.stringify({ slotId: 'good', kind: 'note', path: 'a.txt', label: 'fine', createdAt: 1, detail: { text: 'fine' } }),
      '{ not json',
      JSON.stringify({ slotId: 'toolong', label: 'missing kind', createdAt: 2 }),
      // A duplicate put row, which only a hand-edited log can carry; the fold keeps the first.
      JSON.stringify({ slotId: 'good', kind: 'note', path: 'a.txt', label: 'fine2', createdAt: 3, detail: { text: 'fine2' } }),
      JSON.stringify({ slotId: 'pair', kind: 'note', path: 'a.txt', label: 'pair', createdAt: 4, detail: { text: 'pair' } }),
      JSON.stringify({ slotId: 'pair2', kind: 'note', path: 'a.txt', label: 'pair2', createdAt: 5, detail: { text: 'pair2' } }),
      JSON.stringify({ slotId: 'other', kind: 'note', path: 'b.txt', label: 'other', createdAt: 6, detail: { text: 'other' } }),
      JSON.stringify({ slotId: 'good', released: true }),
      // One line per reader guard: none of these may reach the fold.
      'null',
      '{}',
      JSON.stringify({ slotId: '' }),
      JSON.stringify({ slotId: 'r1', released: false }),
      JSON.stringify({ slotId: 'r2', kind: '', path: 'a', label: 'l', createdAt: 1, detail: {} }),
      JSON.stringify({ slotId: 'r3', kind: 'note', path: 1, label: 'l', createdAt: 1, detail: {} }),
      JSON.stringify({ slotId: 'r4', kind: 'note', path: 'a', label: 1, createdAt: 1, detail: {} }),
      JSON.stringify({ slotId: 'r5', kind: 'note', path: 'a', label: 'l', createdAt: 'no', detail: {} }),
      JSON.stringify({ slotId: 'r6', kind: 'note', path: 'a', label: 'l', createdAt: 1, detail: null }),
      '',
    ].join('\n') + '\n', 'utf8')
    const service = stack.ctx.get('checkpoint') as CheckpointService
    // Released wins over both put rows the duplicated id held; live slots group
    // by path in path order with multiple entries per path intact.
    const timelines = await service.slots(stack.session)
    expect(timelines.map(timeline => [timeline.path, timeline.slots.map(slot => slot.slotId)])).toEqual([
      ['a.txt', ['pair', 'pair2']],
      ['b.txt', ['other']],
    ])
    // The path filter skips live entries that do not match.
    expect(await service.slots(stack.session, 'zzz.txt')).toEqual([])
  })

  it('serves the register over the slotPut and slotRelease remotes', async () => {
    const stack = await harness()
    const service = stack.ctx.get('checkpoint') as CheckpointService
    const slot = await service.putSlotRemote(stack.session, {
      slotId: 'note-1', kind: 'note', path: 'b.txt', label: 'line is wrong', turn: 3, line: 9,
      retained: 'const x = 1', detail: { text: 'line is wrong' },
    })
    expect(slot.after).toBe(digestOf('const x = 1'))
    const [timeline] = await service.slots(stack.session, 'b.txt')
    expect(timeline?.slots[0]?.turn).toBe(3)
    // An explicit after digest rides the row without a retained put.
    const stored = await service.putSlotRemote(stack.session, {
      slotId: 'pin-1', kind: 'worktree', path: 'c.txt', label: 'manual',
      after: digestOf('const x = 1'), detail: { toolName: 'writer' },
    })
    expect(stored.after).toBe(digestOf('const x = 1'))
    await service.releaseSlotRemote(stack.session, 'note-1')
    expect(await service.slots(stack.session).then(list => list.map(entry => entry.path))).toEqual(['c.txt'])
  })

  it('writes no register rows when disabled and refuses puts', async () => {
    const stack = await harness({ enabled: false })
    const service = stack.ctx.get('checkpoint') as CheckpointService
    await stack.run('writer', 'c1', { content: 'one' })
    await expect(service.putSlot(stack.session, { slotId: 'n1', kind: 'note', path: 'a.txt', label: 'x', detail: { text: 'x' } }))
      .rejects.toThrow(/disabled/)
    await service.releaseSlot(stack.session, 'n1')
    expect(await service.slots(stack.session)).toEqual([])
  })
})

describe('checkpoint stops remote', () => {
  it('folds scan rows into per-file stops joined to their tool/call facts', async () => {
    const stack = await harness()
    stack.session.append('tool/call', {
      turn: 1, step: 0, callId: ToolCallId('c1'), name: 'writer', arguments: '{}', purpose: 'stated',
    })
    // A purposeless call joins its stop with turn and step but no purpose, and a
    // log-only event that is neither call nor scan folds past.
    stack.session.append('tool/call', {
      turn: 3, step: 1, callId: ToolCallId('c2'), name: 'writer', arguments: '{}',
    })
    stack.session.append('session/end-seed', {})
    await stack.run('writer', 'c1', { content: 'one' })
    await stack.run('writer', 'c2', { content: 'two' })
    const service = stack.ctx.get('checkpoint') as CheckpointService
    const [timeline] = await service.stops(stack.session)
    expect(timeline?.path).toBe('a.txt')
    expect(timeline?.stops.map(stop => ({
      callId: stop.callId, turn: stop.turn, purpose: stop.purpose, after: stop.after,
    }))).toEqual([
      { callId: 'c1', turn: 1, purpose: 'stated', after: digestOf('one') },
      { callId: 'c2', turn: 3, purpose: undefined, after: digestOf('two') },
    ])
    const [only] = await service.stops(stack.session, 'a.txt')
    expect(only?.stops).toHaveLength(2)
    expect(await service.stops(stack.session, 'other.txt')).toEqual([])
  })

  it('relativizes absolute display paths against the session cwd on capture and fold', async () => {
    const stack = await harness()
    const service = stack.ctx.get('checkpoint') as CheckpointService
    await service.captureWrite({ agent: stack.agent, callId: 'c7', name: 'writer' }, { path: join(stack.root, 'abs.txt'), before: null, after: 'abs' })
    stack.session.append('checkpoint/scan', {
      rows: [{ path: join(stack.root, 'legacy.txt'), callId: ToolCallId('c8'), toolName: 'writer', after: digestOf('old') }],
    })
    // A pre-gate row that carries a before digest but no after folds without one.
    stack.session.append('checkpoint/scan', {
      rows: [{ path: 'partial.txt', callId: ToolCallId('c9b'), toolName: 'writer', before: digestOf('old') }],
    })
    await service.captureWrite({ agent: stack.agent, callId: 'c9', name: 'writer' }, { path: '/elsewhere/far.txt', before: null, after: 'far' })
    // Capture relativizes new rows; rows appended before that keep their log text and fold relative later.
    expect(stack.rows().map(row => row.path)).toEqual(['abs.txt', join(stack.root, 'legacy.txt'), 'partial.txt', '/elsewhere/far.txt'])
    const timelines = await service.stops(stack.session)
    expect(timelines.map(timeline => timeline.path)).toEqual(['/elsewhere/far.txt', 'abs.txt', 'legacy.txt', 'partial.txt'])
    const [outside] = await service.stops(stack.session, '/elsewhere/far.txt')
    expect(outside?.stops).toHaveLength(1)
    const partial = (await service.stops(stack.session, 'partial.txt'))[0]?.stops[0]
    expect(partial?.before).toBe(digestOf('old'))
    expect(partial?.after).toBeUndefined()
  })
})

describe('checkpoint restore surface', () => {
  it('serves retained text and restores a file through the remote surface', async () => {
    const stack = await harness()
    await stack.run('writer', 'c1', { content: 'one' })
    await stack.run('writer', 'c2', { content: 'two' })
    const service = stack.ctx.get('checkpoint') as CheckpointService
    expect(await service.blob(stack.session, digestOf('one'))).toBe('one')
    expect(await service.blob(stack.session, 'sha256:absent')).toBeNull()

    expect(await service.restore(stack.session, 'a.txt', digestOf('one'))).toBe('a.txt')
    expect(await readFile(join(stack.root, 'a.txt'), 'utf8')).toBe('one')
  })

  it('rejects a restore whose blob was never retained', async () => {
    const stack = await harness()
    const service = stack.ctx.get('checkpoint') as CheckpointService
    await expect(service.restore(stack.session, 'a.txt', 'sha256:absent')).rejects.toThrow(/not retained/)
  })

  it('restores through the model-facing tool', async () => {
    const stack = await harness()
    await stack.run('writer', 'c1', { content: 'one' })
    await stack.run('writer', 'c2', { content: 'two' })
    await stack.run('checkpoint_restore', 'c3', { path: 'a.txt', digest: digestOf('one') })
    expect(await readFile(join(stack.root, 'a.txt'), 'utf8')).toBe('one')

    // A dispatch without an owning agent normalizes the refusal into a tool error.
    const agentless = await stack.ctx.tools.execute({
      signal: SIGNAL, callId: ToolCallId('c4'), name: 'checkpoint_restore',
      arguments: { path: 'a.txt', digest: digestOf('one') },
    })
    expect(agentless.isError).toBe(true)
    expect(JSON.stringify(agentless.content)).toContain('owning agent session')
  })
})

describe('checkpoint plugin lifecycle', () => {
  it('removes its tool registration when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SandboxPolicyService, { workspaceRoot: process.cwd() })
    await ctx.plugin(LocalFileSystem, { cwd: process.cwd() })
    const fiber = await ctx.plugin(CheckpointService, {
      enabled: true, maxLabelBytes: 8192, maxRetainedBytes: 8192,
    })
    expect(ctx.tools.schemas().some(schema => schema.name === 'checkpoint_restore')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'checkpoint_restore')).toBe(false)
  })
})
