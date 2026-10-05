import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-system-prompt'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'
import * as AgentInvariant from '@deepseek-ai/dsh-agent/invariant'
import * as AgentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import SubagentRuntime, {
  type ResolvedSubagentStartRequest,
  type SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { startInProcessRun } from '../src/index.ts'

const SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: { handoff: { type: 'string' } },
  required: ['handoff'],
}

/** MockAdapter with the native grammar flag so the runtime keeps the field. */
class SchemaCapableAdapter extends MockAdapter {
  override readonly structuredOutputOnRequest = true
}

async function setup(script: ConstructorParameters<typeof MockAdapter>[0]) {
  const ctx = new Context()
  const adapter = new SchemaCapableAdapter(script)
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SessionInvariant)
  await ctx.plugin(AgentInvariant)
  await ctx.plugin(AgentLoopInvariant)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: {
      agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: false,
      persona: false, stepBudget: true, childSandboxMode: true,
    },
    inheritsParentContext: false,
    start: (request: ResolvedSubagentStartRequest) => startInProcessRun(request, {}),
  })
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, adapter }
}

function budgetRequest(parent: SubagentStartRequest['parent'], extra?: Partial<SubagentStartRequest>): SubagentStartRequest {
  return {
    label: 'read and hand off',
    prompt: [{ type: 'text', text: 'read and hand off' }],
    parent,
    signal: new AbortController().signal,
    outputSchema: SCHEMA,
    ...extra,
  }
}

describe('in-process step budget', () => {
  it('steers one schema-forced consolidation step when an uncapped child tries to settle', async () => {
    const { ctx, parent, adapter } = await setup([
      textResponse('rambling notes, no capture'),
      textResponse(JSON.stringify({ handoff: 'the finding' })),
    ])
    const run = await ctx.subagents.start('spawn', budgetRequest(parent))
    const result = await run.result
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests.at(0)?.structuredOutput).toBeUndefined()
    expect(adapter.requests.at(1)?.structuredOutput).toEqual(SCHEMA)
    expect(result.stopReason).toBe('completed')
    expect(result.structured).toEqual({ handoff: 'the finding' })
    await run.dispose()
  })

  it('a second bare settling settles error, never a third model step', async () => {
    const { ctx, parent, adapter } = await setup([
      textResponse('prose again'),
      textResponse('still prose, not the handoff'),
      textResponse('MUST NOT BE CONSUMED'),
    ])
    const run = await ctx.subagents.start('spawn', budgetRequest(parent, { maxSteps: 1 }))
    const result = await run.result
    expect(adapter.requests).toHaveLength(2)
    expect(result.stopReason).toBe('error')
    await run.dispose()
  })

  it('denies exploration steps after the consolidation step', async () => {
    const { ctx, parent, adapter } = await setup([
      textResponse('still exploring'),
      toolCallResponse('c1', 'poke', {}),
      textResponse('tries a fourth step'),
    ])
    ctx.tools.register(defineContentToolFixture({
      name: 'poke',
      description: 'probe',
      parameters: {},
      execute(): Promise<ContentBlock[]> {
        return Promise.resolve([{ type: 'text', text: 'poked' }])
      },
    }))
    const run = await ctx.subagents.start('spawn', budgetRequest(parent, { maxSteps: 1 }))
    const result = await run.result
    expect(adapter.requests).toHaveLength(2)
    expect(result.stopReason).not.toBe('completed')
    await run.dispose()
  })

  it('writes the child session first sandbox event from childSandboxMode', async () => {
    const { ctx, parent } = await setup([
      textResponse(JSON.stringify({ handoff: 'done' })),
    ])
    const run = await ctx.subagents.start('spawn', budgetRequest(parent, { childSandboxMode: 'read-only' }))
    await run.result
    const child = run.localAgent
    expect(child).toBeDefined()
    const modes = child!.session.snapshotEvents()
      .flatMap(event => event.type === 'sandbox/mode' ? [event.data.mode] : [])
    expect(modes[0]).toBe('read-only')
    await run.dispose()
  })
})
