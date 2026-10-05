import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as DelegationCap from '../src/index.ts'
import type { Config } from '../src/index.ts'

async function harness(config: Config): Promise<{ ctx: Context; parent: Agent; adapter: MockAdapter }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(DelegationCap, config)
  ctx.tools.register(defineContentToolFixture({
    name: 'explore',
    description: 'reader',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'rounds of reading' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'errand',
    description: 'plain',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'ran' }] },
  }))
  const adapter = new MockAdapter([])
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, adapter }
}

describe('delegation-cap guard', () => {
  it('allows cap calls in one turn and denies the next with the cap reason', async () => {
    const { ctx, parent, adapter } = await harness({ tools: ['explore'], maxDelegationsPerTurn: 2 })
    ;(adapter as unknown as { script: unknown[] }).script = [
      toolCallResponse('c1', 'explore', {}),
      toolCallResponse('c2', 'explore', {}),
      toolCallResponse('c3', 'explore', {}),
    ] as never
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'survey the codebase' }], source: { kind: 'user' } } as never)
    await new Promise<void>((resolve) => {
      const d = ctx.on('agent/status', ({ agent, status }) => {
        if (agent === parent && status === 'idle') { d(); resolve() }
      })
    })
    const results = parent.session.snapshotEvents().filter(e => e.type === 'tool/result')
    expect(results).toHaveLength(3)
    const first = results[0] as { data: { message: { content: { isError?: boolean }[] } } }
    expect(first.data.message.content[0]?.isError).not.toBe(true)
    const third = results[2] as { data: { message: { content: { isError?: boolean; text?: string }[] } } }
    expect(third.data.message.content[0]?.isError).toBe(true)
    expect(JSON.stringify(third.data.message.content)).toContain('delegation cap reached')
  })

  it('counts only the configured tools and resets on the next turn', async () => {
    const { ctx, parent, adapter } = await harness({ tools: ['explore'], maxDelegationsPerTurn: 1 })
    ;(adapter as unknown as { script: unknown[] }).script = [
      toolCallResponse('c1', 'explore', {}),
      toolCallResponse('c2', 'errand', {}),
      textResponse('after turn one'),
      toolCallResponse('c4', 'explore', {}),
      textResponse('after turn two'),
    ] as never
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } } as never)
    await new Promise<void>((resolve) => {
      const d = ctx.on('agent/status', ({ agent, status }) => {
        if (agent === parent && status === 'idle') { d(); resolve() }
      })
    })
    const results = parent.session.snapshotEvents().filter(e => e.type === 'tool/result') as unknown as { data: { message: { content: { isError?: boolean }[] } } }[]
    // explore ok, errand ok (not counted), then second turn explore ok again
    expect(results.filter(r => r.data.message.content[0]?.isError === true)).toHaveLength(0)
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } } as never)
    await new Promise<void>((resolve) => {
      const d = ctx.on('agent/status', ({ agent, status }) => {
        if (agent === parent && status === 'idle') { d(); resolve() }
      })
    })
  })

  it('counts a batched call as one start per task entry', async () => {
    const { ctx, parent, adapter } = await harness({ tools: ['explore'], maxDelegationsPerTurn: 3 })
    ;(adapter as unknown as { script: unknown[] }).script = [
      toolCallResponse('c1', 'explore', { tasks: [{ description: 'a' }, { description: 'b' }] }),
      toolCallResponse('c2', 'explore', {}),
    ] as never
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'survey broadly' }], source: { kind: 'user' } } as never)
    await new Promise<void>((resolve) => {
      const d = ctx.on('agent/status', ({ agent, status }) => {
        if (agent === parent && status === 'idle') { d(); resolve() }
      })
    })
    const results = parent.session.snapshotEvents().filter(e => e.type === 'tool/result')
    expect(results).toHaveLength(2)
    const batched = results[0] as { data: { message: { content: { isError?: boolean }[] } } }
    expect(batched.data.message.content[0]?.isError).not.toBe(true)
    const single = results[1] as { data: { message: { content: { isError?: boolean }[] } } }
    expect(single.data.message.content[0]?.isError).toBe(true)
    expect(JSON.stringify(single.data.message.content)).toContain('delegation cap reached')
  })

  it('denies a batch whose entries alone exceed the budget', async () => {
    const { ctx, parent, adapter } = await harness({ tools: ['explore'], maxDelegationsPerTurn: 2 })
    ;(adapter as unknown as { script: unknown[] }).script = [
      toolCallResponse('c1', 'explore', { tasks: [{ description: 'a' }, { description: 'b' }] }),
    ] as never
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'survey broadly' }], source: { kind: 'user' } } as never)
    await new Promise<void>((resolve) => {
      const d = ctx.on('agent/status', ({ agent, status }) => {
        if (agent === parent && status === 'idle') { d(); resolve() }
      })
    })
    const results = parent.session.snapshotEvents().filter(e => e.type === 'tool/result')
    expect(results).toHaveLength(1)
    const batched = results[0] as { data: { message: { content: { isError?: boolean }[] } } }
    expect(batched.data.message.content[0]?.isError).toBe(true)
    expect(JSON.stringify(batched.data.message.content)).toContain('delegation cap reached')
  })

  it('fails loud at load on an empty tools list', () => {
    // The product path (Loader over cordis.yml) rejects a throwing apply, as the
    // tool-subagent mount-rejection suites prove; the bare-Context harness here
    // detaches fiber failures, so assert the operation that owns the decision.
    const ctx = new Context()
    expect(() => { DelegationCap.apply(ctx, { tools: [], maxDelegationsPerTurn: 3 }) }).toThrow(/at least one delegation tool/)
  })
})
