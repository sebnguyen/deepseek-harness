/** Covers write-file capture: row attribution from before/after text, restore, and disposal. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import CheckpointService, { digestOf } from '../src/index.ts'
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
async function harness(options: { enabled?: boolean; home?: string; sessionId?: string; root?: string } = {}): Promise<Harness> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'dsh-checkpoint-ws-'))
  const home = options.home ?? await mkdtemp(join(tmpdir(), 'dsh-checkpoint-home-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(CheckpointService, { enabled: options.enabled ?? true, dshHome: home })
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

describe('checkpoint stops remote', () => {
  it('folds scan rows into per-file stops joined to their tool/call facts', async () => {
    const stack = await harness()
    stack.session.append('tool/call', {
      turn: 1, step: 0, callId: ToolCallId('c1'), name: 'writer', arguments: '{}', purpose: 'stated',
    })
    await stack.run('writer', 'c1', { content: 'one' })
    await stack.run('writer', 'c2', { content: 'two' })
    const service = stack.ctx.get('checkpoint') as CheckpointService
    const [timeline] = await service.stops(stack.session)
    expect(timeline?.path).toBe('a.txt')
    expect(timeline?.stops.map(stop => ({
      callId: stop.callId, turn: stop.turn, purpose: stop.purpose, after: stop.after,
    }))).toEqual([
      { callId: 'c1', turn: 1, purpose: 'stated', after: digestOf('one') },
      { callId: 'c2', turn: undefined, purpose: undefined, after: digestOf('two') },
    ])
    const [only] = await service.stops(stack.session, 'a.txt')
    expect(only?.stops).toHaveLength(2)
    expect(await service.stops(stack.session, 'other.txt')).toEqual([])
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
    const fiber = await ctx.plugin(CheckpointService, { enabled: true })
    expect(ctx.tools.schemas().some(schema => schema.name === 'checkpoint_restore')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'checkpoint_restore')).toBe(false)
  })
})
