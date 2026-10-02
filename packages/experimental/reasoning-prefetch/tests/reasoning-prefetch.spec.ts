import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as prefetch from '../src/index.ts'
import type { Config } from '../src/index.ts'

const SECOND_BODY = 'export const second = 2\n'
const CLEAN_BODY = 'export const clean = 1\n'

function reasoningResponse(text: string): StreamChunk[] {
  const half = Math.floor(text.length / 2)
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: text.slice(0, half) },
    { type: 'reasoning-delta', index: 0, text: text.slice(half) },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function reasoningThenToolCall(text: string, callId: string, toolName: string, args: object): StreamChunk[] {
  const argumentsJson = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text } },
    { type: 'block-start', index: 1, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 1, id: ToolCallId(callId), name: toolName, argumentsDelta: argumentsJson },
    { type: 'block-end', index: 1, block: { type: 'tool-call', id: ToolCallId(callId), name: toolName, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  constructor(private script: StreamChunk[][]) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('script exhausted')
    for (const chunk of entry) yield chunk
  }
}

async function harness(
  adapter: ScriptAdapter,
  config: Config,
  _workspace: string,
  options: { fs?: boolean } = {},
) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  if (options.fs !== false) await ctx.plugin(LocalFileSystem, {})
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(prefetch, config)
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function userTexts(agent: Agent): string[] {
  return agent.session.snapshotEvents()
    .filter(event => event.type === 'user/message')
    .flatMap(event => event.type === 'user/message' ? event.data.content : [])
    .flatMap(block => block.type === 'text' ? [block.text] : [])
}

let workspace = ''

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'psa-'))
  await mkdir(join(workspace, 'src'), { recursive: true })
  await mkdir(join(workspace, 'docs'), { recursive: true })
  await writeFile(join(workspace, 'src', 'clean.ts'), CLEAN_BODY)
  await writeFile(join(workspace, 'src', 'second.ts'), SECOND_BODY)
  await writeFile(join(workspace, 'docs', 'guide.md'), '# guide\n')
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('reasoning-prefetch', () => {
  it('injects a predicted-but-not-called read into the next step and skips the called file', async () => {
    const adapter = new ScriptAdapter([
      reasoningThenToolCall(
        'I will read `src/clean.ts` now, and later I must open `src/second.ts`.',
        'call-1', 'read', { path: 'src/clean.ts' },
      ),
      reasoningResponse('done, both inspected'),
    ])
    const ctx = await harness(adapter, {}, workspace)
    ctx.tools.register(defineContentToolFixture({
      name: 'read',
      description: 'read a file',
      parameters: {},
      async execute(): Promise<import('@deepseek-ai/dsh-llm').ContentBlock[]> {
        return [{ type: 'text', text: 'mocked read body.' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('psa-read'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'orient yourself')
    await waitForIdle(ctx, agent)

    const injectionTexts = userTexts(agent).filter(text => text.includes('Harness detected these potential reads'))
    expect(injectionTexts.length).toBe(1)
    const injected = injectionTexts[0] ?? ''
    expect(injected).toContain('src/second.ts')
    expect(injected).toContain(SECOND_BODY.trim())
    expect(injected).not.toContain('src/clean.ts')
  })

  it('stages a directory listing for a listing-verb directory span', async () => {
    const adapter = new ScriptAdapter([
      reasoningThenToolCall('first I should list docs/ to see what is there.', 'call-1', 'noop', {}),
      reasoningResponse('done'),
    ])
    const ctx = await harness(adapter, {}, workspace)
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'noop',
      parameters: {},
      async execute(): Promise<import('@deepseek-ai/dsh-llm').ContentBlock[]> {
        return [{ type: 'text', text: 'ok.' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('psa-glob'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'orient yourself')
    await waitForIdle(ctx, agent)

    const injected = userTexts(agent).find(text => text.includes('Harness detected these potential reads')) ?? ''
    expect(injected).toContain('docs/guide.md')
  })

  it('honors explicit budgets and lists empty directories as empty', async () => {
    await mkdir(join(workspace, 'empty'), { recursive: true })
    const adapter = new ScriptAdapter([
      reasoningThenToolCall('open `src/second.ts` and list empty/ now reading `src/clean.ts` and `src/second.ts` again.', 'call-1', 'noop', {}),
      reasoningResponse('done'),
    ])
    const ctx = await harness(adapter, {
      maxFiles: 4,
      maxFileBytes: 16_384,
      maxTotalBytes: 65_536,
      prefetchWaitMs: 50,
      listLines: 40,
      parsePoint: 'attempt-end',
    }, workspace)
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'noop',
      parameters: {},
      async execute(): Promise<import('@deepseek-ai/dsh-llm').ContentBlock[]> {
        return [{ type: 'text', text: 'ok.' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('psa-budgets'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'orient yourself')
    await waitForIdle(ctx, agent)

    const injected = userTexts(agent).find(text => text.includes('Harness detected these potential reads')) ?? ''
    expect(injected).toContain('(empty)')
    expect(injected).toContain('src/second.ts')
  })

  it('rides the pre-step decision when parsePoint is pre-step', async () => {
    const adapter = new ScriptAdapter([
      reasoningThenToolCall('later I must open `src/second.ts`.', 'call-1', 'noop', {}),
      reasoningResponse('done'),
    ])
    const ctx = await harness(adapter, { parsePoint: 'pre-step' }, workspace)
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'noop',
      parameters: {},
      async execute(): Promise<import('@deepseek-ai/dsh-llm').ContentBlock[]> {
        return [{ type: 'text', text: 'ok.' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('psa-prestep'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'orient yourself')
    await waitForIdle(ctx, agent)

    const injected = userTexts(agent).find(text => text.includes('Harness detected these potential reads')) ?? ''
    expect(injected).toContain('src/second.ts')
  })

  it('no-ops cleanly without a filesystem provider', async () => {
    const adapter = new ScriptAdapter([
      reasoningThenToolCall('later I must open `src/second.ts`.', 'call-1', 'noop', {}),
      reasoningResponse('done'),
    ])
    const ctx = await harness(adapter, {}, workspace, { fs: false })
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'noop',
      parameters: {},
      async execute(): Promise<import('@deepseek-ai/dsh-llm').ContentBlock[]> {
        return [{ type: 'text', text: 'ok.' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('psa-nofs'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'orient yourself')
    await waitForIdle(ctx, agent)

    expect(userTexts(agent).some(text => text.includes('Harness detected these potential reads'))).toBe(false)
  })

  it('ignores attempts whose reasoning sealed empty', async () => {
    const adapter = new ScriptAdapter([
      [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'nothing to think about' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'nothing to think about' } },
        { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
      reasoningResponse('rest'),
    ])
    const ctx = await harness(adapter, {}, workspace)
    const agent = await ctx.agentLoop.create(SessionId('psa-empty'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'hello')
    await waitForIdle(ctx, agent)

    expect(userTexts(agent).some(text => text.includes('Harness detected these potential reads'))).toBe(false)
  })

  it('orders multiple sealed reasoning blocks before parsing', async () => {
    const adapter = new ScriptAdapter([
      [
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: 'later I must open `src/second.ts`.' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'later I must open `src/second.ts`.' } },
        { type: 'block-start', index: 1, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 1, text: 'also list docs/ layout.' },
        { type: 'block-end', index: 1, block: { type: 'reasoning', text: 'also list docs/ layout.' } },
        { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
        { type: 'block-start', index: 2, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 2, id: ToolCallId('call-1'), name: 'noop', argumentsDelta: '{}' },
        { type: 'block-end', index: 2, block: { type: 'tool-call', id: ToolCallId('call-1'), name: 'noop', arguments: '{}' } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ],
      reasoningResponse('rest'),
    ])
    const ctx = await harness(adapter, {}, workspace)
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'noop',
      parameters: {},
      async execute(): Promise<import('@deepseek-ai/dsh-llm').ContentBlock[]> {
        return [{ type: 'text', text: 'ok.' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('psa-multi'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'hello')
    await waitForIdle(ctx, agent)

    const injected = userTexts(agent).find(text => text.includes('Harness detected these potential reads')) ?? ''
    expect(injected).toContain('src/second.ts')
    expect(injected).toContain('docs/guide.md')
  })

  it('skips staging past a zero prefetch window', async () => {
    const adapter = new ScriptAdapter([
      reasoningThenToolCall('later I must open `src/second.ts`.', 'call-1', 'noop', {}),
      reasoningResponse('done'),
    ])
    const ctx = await harness(adapter, { prefetchWaitMs: 0 }, workspace)
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'noop',
      parameters: {},
      async execute(): Promise<import('@deepseek-ai/dsh-llm').ContentBlock[]> {
        return [{ type: 'text', text: 'ok.' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('psa-nowait'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'orient yourself')
    await waitForIdle(ctx, agent)

    expect(userTexts(agent).some(text => text.includes('Harness detected these potential reads'))).toBe(false)
  })

  it('extracts spans, verbs, and dedup vocabulary deterministically', async () => {
    const { extractCandidates } = await import('../src/extract.ts')
    const candidates = extractCandidates('read `src/clean.ts:12` now. Then grep for "budget" across src/. list docs/ layout next.')
    const read = candidates.find(c => c.span === 'src/clean.ts')
    expect(read?.op).toBe('read')
    const grep = candidates.find(c => c.op === 'grep')
    expect(grep?.span).toBe('budget')
    const glob = candidates.find(c => c.op === 'glob')
    expect(glob?.span).toBe('docs/')
    const inert = extractCandidates('the docs/ directory exists but stays unread')
    expect(inert.some(c => c.op === 'glob')).toBe(false)
    const absolute = extractCandidates('maybe /home/user/docs/x.md later, and the word "budget" stays plain.')
    expect(absolute.some(c => c.op === 'read' && c.span === '/home/user/docs/x.md')).toBe(true)
    expect(absolute.some(c => c.op === 'grep')).toBe(false)
    const matrix = extractCandidates(
      'peek `docs/` first. check `guide.md`. open `src/dup.ts` then open `src/dup.ts` again. list `docs/` layout. read `docs/`. check `budget`. list src/ layout. src/ stage again. src/ stage once more.',
    )
    const dups = matrix.filter(c => c.span === 'src/dup.ts')
    expect(dups.length).toBe(1)
    const backtickDir = matrix.filter(c => c.span === 'docs/')
    expect(backtickDir.map(c => c.op).sort()).toEqual(['glob', 'read'])
    expect(matrix.some(c => c.op === 'glob' && c.span === 'src/')).toBe(true)
  })

  it('resolves budgets from partial and full configs', async () => {
    const { resolveBudgets } = await import('../src/index.ts')
    expect(resolveBudgets({})).toEqual({
      budget: { maxFiles: 4, maxFileBytes: 16_384, maxTotalBytes: 65_536, listLines: 40 },
      waitMs: 50,
    })
    expect(resolveBudgets({ maxFiles: 1, maxFileBytes: 2, maxTotalBytes: 64, prefetchWaitMs: 1, listLines: 1 })).toEqual({
      budget: { maxFiles: 1, maxFileBytes: 2, maxTotalBytes: 64, listLines: 1 },
      waitMs: 1,
    })
  })

  it('disposes attempt state with the plugin fiber', async () => {
    const adapter = new ScriptAdapter([
      reasoningThenToolCall('later I must open `src/second.ts`.', 'call-1', 'noop', {}),
      reasoningResponse('done'),
    ])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, {})
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    const fiber = await ctx.plugin(prefetch, {})
    ctx.llm.registerAdapter(['mock'], adapter)
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'noop',
      parameters: {},
      async execute(): Promise<import('@deepseek-ai/dsh-llm').ContentBlock[]> {
        return [{ type: 'text', text: 'ok.' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('psa-dispose'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'orient yourself')
    await waitForIdle(ctx, agent)
    await fiber.dispose()

    expect(userTexts(agent).some(text => text.includes('Harness detected these potential reads'))).toBe(true)
  })

  it('suppresses staging when the model response continues mid-thought', async () => {
    const stuckText = 'let me look at'
    const adapter = new ScriptAdapter([
      [
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: 'later I must open `src/second.ts`.' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'later I must open `src/second.ts`.' } },
        { type: 'block-start', index: 1, blockType: 'text' },
        { type: 'text-delta', index: 1, text: stuckText },
        { type: 'block-end', index: 1, block: { type: 'text', text: stuckText } },
        { type: 'block-start', index: 2, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 2, id: ToolCallId('call-1'), name: 'noop', argumentsDelta: '{}' },
        { type: 'block-end', index: 2, block: { type: 'tool-call', id: ToolCallId('call-1'), name: 'noop', arguments: '{}' } },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ],
    ])
    const ctx = await harness(adapter, {}, workspace)
    ctx.tools.register(defineContentToolFixture({
      name: 'noop',
      description: 'noop',
      parameters: {},
      async execute(): Promise<import('@deepseek-ai/dsh-llm').ContentBlock[]> {
        return [{ type: 'text', text: 'ok.' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('psa-stuck'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'orient yourself')
    await waitForIdle(ctx, agent)

    expect(userTexts(agent).some(text => text.includes('Harness detected these potential reads'))).toBe(false)
  })

  it('derives candidates from the assistant reasoning stream only', async () => {
    // Decoy spans ride every non-reasoning channel — the user turn, the visible
    // answer, and a tool result — beside one sealed reasoning span that must
    // still stage; only the reasoning block may feed extraction.
    const adapter = new ScriptAdapter([
      [
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: 'the ask names `src/second.ts`; the decoys are settled.' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'the ask names `src/second.ts`; the decoys are settled.' } },
        { type: 'block-start', index: 1, blockType: 'text' },
        { type: 'text-delta', index: 1, text: 'checking src/clean.ts first.' },
        { type: 'block-end', index: 1, block: { type: 'text', text: 'checking src/clean.ts first.' } },
        { type: 'block-start', index: 2, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 2, id: ToolCallId('call-1'), name: 'echo', argumentsDelta: '{}' },
        { type: 'block-end', index: 2, block: { type: 'tool-call', id: ToolCallId('call-1'), name: 'echo', arguments: '{}' } },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ],
      [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'done; src/clean.ts and docs/guide.md are as expected.' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'done; src/clean.ts and docs/guide.md are as expected.' } },
        { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    ])
    const ctx = await harness(adapter, {}, workspace)
    ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'echo',
      parameters: {},
      async execute(): Promise<import('@deepseek-ai/dsh-llm').ContentBlock[]> {
        return [{ type: 'text', text: 'later, docs/guide.md needs a reread.' }]
      },
    }))
    const agent = await ctx.agentLoop.create(SessionId('psa-source'), { provider: 'mock', model: 'mock' }, { cwd: workspace })

    send(agent, 'orient using src/clean.ts first')
    await waitForIdle(ctx, agent)

    const injectionTexts = userTexts(agent).filter(text => text.includes('Harness detected these potential reads'))
    expect(injectionTexts.length).toBe(1)
    const injected = injectionTexts[0] ?? ''
    expect(injected).toContain('src/second.ts')
    expect(injected).not.toContain('src/clean.ts')
    expect(injected).not.toContain('docs/guide.md')
  })
})
