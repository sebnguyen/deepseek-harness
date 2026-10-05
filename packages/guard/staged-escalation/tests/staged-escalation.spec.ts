/**
 * Behavior tests for staged-escalation: the explore-then-act gate denies act
 * tools with the one-line refusal and lifts on turn-local evidence, the
 * reminder injects the configured description at step 1, the
 * sandbox-policy seam clamps narrow-only, and load-time misconfiguration
 * fails loud.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, toolCallResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as StagedEscalation from '../src/index.ts'
import { currentStage, type StagedEscalationSource } from '../src/index.ts'
import type { Config, Stage } from '../src/index.ts'

const LADDER: Stage[] = [
  {
    name: 'explore',
    description: 'Probe first; parallel subagents are cheaper than wrong edits.',
    allow: ['read', 'explore', 'ask_user_question'],
    sandbox: 'read-only',
  },
  {
    name: 'act',
    description: 'Spend the gathered evidence.',
    allow: ['*'],
    sandbox: 'workspace-write',
  },
]

const LADDER3: Stage[] = [
  {
    name: 'explore',
    description: 'Probe first.',
    allow: ['read'],
    sandbox: 'read-only',
  },
  {
    name: 'draft',
    description: 'Write drafts.',
    allow: ['write'],
    sandbox: 'workspace-write',
  },
  {
    name: 'ship',
    description: 'Publish.',
    allow: ['*'],
    sandbox: 'workspace-write',
  },
]

async function harness(config: Config): Promise<{ ctx: Context; parent: Agent; adapter: MockAdapter }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(StagedEscalation, config)
  ctx.tools.register(defineContentToolFixture({
    name: 'read',
    description: 'reader',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'pinned lines' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'write',
    description: 'writer',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'written' }] },
  }))
  const adapter = new MockAdapter([])
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, adapter }
}

async function settle(ctx: Context, parent: Agent): Promise<void> {
  await new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent, status }) => {
      if (agent === parent && status === 'idle') { dispose(); resolve() }
    })
  })
}

function toolOutcomes(parent: Agent): { isError: boolean; text: string }[] {
  return parent.session.snapshotEvents().filter(event => event.type === 'tool/result').map((event) => {
    if (event.type !== 'tool/result') throw new Error('unreachable')
    const block = event.data.message.content[0]
    const textBlock = block.content.find(part => part.type === 'text')
    return { isError: block.isError === true, text: textBlock?.type === 'text' ? textBlock.text : '' }
  })
}

describe('staged-escalation gate', () => {
  it('denies act tools on an evidence-less turn and lifts after one explore move', async () => {
    const { ctx, parent, adapter } = await harness({ stages: LADDER })
    ;(adapter as unknown as { script: unknown[] }).script = [
      toolCallResponse('c1', 'write', {}),
      toolCallResponse('c2', 'read', {}),
      toolCallResponse('c3', 'write', {}),
      textResponse('done'),
    ] as never
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'change the auth flow' }], source: { kind: 'user' } } as never)
    await settle(ctx, parent)
    const outcomes = toolOutcomes(parent)
    expect(outcomes.map(outcome => outcome.isError)).toEqual([true, false, false])
    expect(outcomes[0]?.text ?? '').toContain('This tool is blocked due to your "explore" stage')
    expect(outcomes[0]?.text ?? '').toContain('trigger request_escalation')
  })

  it('re-arms on the next user message', async () => {
    const { ctx, parent, adapter } = await harness({ stages: LADDER })
    ;(adapter as unknown as { script: unknown[] }).script = [
      toolCallResponse('c1', 'read', {}),
      toolCallResponse('c2', 'write', {}),
      textResponse('turn one done'),
      toolCallResponse('c3', 'write', {}),
      textResponse('turn two done'),
    ] as never
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'first task' }], source: { kind: 'user' } } as never)
    await settle(ctx, parent)
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'second task' }], source: { kind: 'user' } } as never)
    await settle(ctx, parent)
    const outcomes = toolOutcomes(parent)
    expect(outcomes.map(outcome => outcome.isError)).toEqual([false, false, true])
    expect(outcomes[2]?.text ?? '').toContain('blocked due to your "explore" stage')
  })

  it('injects the step-1 reminder carrying the stage description verbatim', async () => {
    const { ctx, parent, adapter } = await harness({ stages: LADDER })
    ;(adapter as unknown as { script: unknown[] }).script = [textResponse('noted')] as never
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'a task' }], source: { kind: 'user' } } as never)
    await settle(ctx, parent)
    const injected = parent.session.snapshotEvents().filter((event): event is Extract<typeof event, { type: 'user/message' }> =>
      event.type === 'user/message' && event.data.source.kind === 'staged-escalation')
    expect(injected).toHaveLength(1)
    const first = injected[0]
    if (first === undefined) throw new Error('expected the reminder message')
    const textBlock = first.data.content.find(part => part.type === 'text')
    expect(textBlock?.type === 'text' ? textBlock.text : '').toContain('You are in the "explore" stage.')
    expect(textBlock?.type === 'text' ? textBlock.text : '').toContain('Probe first; parallel subagents are cheaper than wrong edits.')
    expect((first.data.source as StagedEscalationSource).currentStage).toBe('explore')
  })

  it('ships the shell in the explore stage: bash and pwsh run read-only on an evidence-less turn and lift act', async () => {
    const { ctx, parent, adapter } = await harness({})
    for (const shell of ['bash', 'pwsh']) {
      ctx.tools.register(defineContentToolFixture({
        name: shell,
        description: 'shell',
        parameters: {},
        async execute() { return [{ type: 'text', text: `${shell} ran` }] },
      }))
    }
    await ctx.plugin(SandboxPolicyService, { mode: 'danger-full-access' })
    const locked = await ctx.sandboxPolicy.resolveClamped({ session: parent.session })
    expect(locked.mode).toBe('read-only')
    ;(adapter as unknown as { script: unknown[] }).script = [
      toolCallResponse('c1', 'bash', {}),
      toolCallResponse('c2', 'pwsh', {}),
      toolCallResponse('c3', 'write', {}),
      textResponse('done'),
    ] as never
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'inspect then fix' }], source: { kind: 'user' } } as never)
    await settle(ctx, parent)
    const outcomes = toolOutcomes(parent)
    expect(outcomes.map(outcome => outcome.isError)).toEqual([false, false, false])
    expect(outcomes[0]?.text ?? '').toBe('bash ran')
  })

  it('clamps the resolved sandbox policy narrow-only and never widens', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SandboxPolicyService, { mode: 'danger-full-access' })
    await ctx.plugin(StagedEscalation, { stages: LADDER })
    const sessionId = SessionId('clamped')
    const session = Session.create(sessionId, undefined, {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 0,
      isSeeded: false,
    })
    const policy = await ctx.sandboxPolicy.resolveClamped({ session })
    expect(policy.mode).toBe('read-only')
    const sessionless = await ctx.sandboxPolicy.resolveClamped()
    expect(sessionless.mode).toBe('danger-full-access')
  })

  it('validates the ladder loud at load', async () => {
    const loadMessage = async (config: Config): Promise<string> => {
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      try {
        await ctx.plugin(StagedEscalation, config)
        return ''
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    expect(await loadMessage({ stages: [] })).toContain('at least one stage')
    expect(await loadMessage({
      stages: [
        { name: 'a', description: 'x', allow: ['read'], sandbox: 'read-only' },
        { name: 'a', description: 'x', allow: ['*'], sandbox: 'workspace-write' },
      ],
    })).toContain('duplicated stage name')
    expect(await loadMessage({
      stages: [
        { name: 'a', description: 'x', allow: ['*'], sandbox: 'read-only' },
        { name: 'b', description: 'x', allow: ['read'], sandbox: 'workspace-write' },
      ],
    })).toContain("'*' must sit alone on the last stage")
    expect(await loadMessage({ stages: LADDER })).toBe('')
  })


  it('folds grants and evidence into the current stage', () => {
    const sessionId = SessionId('fold')
    const session = Session.create(sessionId, undefined, {
      version: SESSION_FORMAT_VERSION,
      id: sessionId,
      createdAt: 0,
      isSeeded: false,
    })
    expect(currentStage(LADDER3, session)).toBe(0)
    session.append('turn/start', { turn: 1 })
    const call = (id: string, name: string, step: number) =>
      session.append('tool/call', { turn: 1, step, callId: ToolCallId(id), name, arguments: '{}' })
    const result = (id: string, step: number, text: string, isError?: boolean) =>
      session.append('tool/result', {
        turn: 1,
        step,
        message: createToolResultMessage({
          callId: ToolCallId(id),
          content: [{ type: 'text', text }],
          isError: isError ?? false,
        }),
      }, { surfaceOp: 'append' })
    call('c1', 'read', 1)
    result('c1', 1, 'pinned lines')
    expect(currentStage(LADDER3, session)).toBe(1)
    call('c2', 'request_escalation', 2)
    result('c2', 2, '[staging] You are in the "ship" stage.\n\nPublish.\nThis promotion lasts this turn only.')
    expect(currentStage(LADDER3, session)).toBe(2)
    // A denied result does not move the fold, and a made-up stage name is ignored.
    call('c3', 'read', 3)
    result('c3', 3, 'failed', true)
    call('c4', 'read', 4)
    result('c4', 4, '[staging] You are in the "bogus" stage.\nX\nY')
    expect(currentStage(LADDER3, session)).toBe(2)
  })
})
