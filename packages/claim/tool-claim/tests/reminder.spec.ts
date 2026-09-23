import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { apply } from '@deepseek-ai/dsh-tool-claim'

type PreStepListener = (
  payload: { agent: Agent; messages: never[]; turn: number; step: number; signal: AbortSignal },
  next: () => Promise<PreStepDecision>,
) => Promise<PreStepDecision>

type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: { readonly source?: unknown }[] }

/** Install the plugin against a stub context and capture its listeners. */
function harness(agent: Agent): Record<'agent/pre-step', PreStepListener> {
  const listeners: Record<'agent/pre-step', PreStepListener> = {
    'agent/pre-step': () => Promise.resolve({ kind: 'reject' }),
  }
  const ctx = {
    systemPrompt: { section: () => { }, getSectionOrder: () => 2450 },
    tools: { register: () => { } },
    agents: { get: (id: string) => (id === agent.id ? agent : undefined) },
    claims: {},
    sessionProjections: {},
    on: (event: 'agent/pre-step', listener: PreStepListener) => { listeners[event] = listener },
  }
  apply(ctx as unknown as Context)
  return listeners
}

function stubAgent(id: string): Agent {
  return { id, inbox: { nextStep: [], nextTurn: [] } } as unknown as Agent
}

describe('claim declaration reminder', () => {
  it('appends one plugin-sourced reminder at the first step of a turn', async () => {
    const agent = stubAgent('agent-1')
    const listener = harness(agent)['agent/pre-step']
    const decision = await listener(
      { agent, messages: [], turn: 3, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(1)
    const source = decision.messages[0]?.source as { kind: string; plugin: string } | undefined
    expect(source).toEqual({ kind: 'plugin', plugin: 'tool-claim' })
    const text = (decision.messages[0] as { content?: { text: string }[] }).content?.[0]?.text ?? ''
    expect(text).toContain('skip claims')
    expect(text).toContain('verification script')
  })

  it('does not remind on repair steps or for an agent that left the registry', async () => {
    const agent = stubAgent('agent-1')
    const listener = harness(agent)['agent/pre-step']
    const later = await listener(
      { agent, messages: [], turn: 1, step: 2, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    expect(later.kind === 'enter' && later.messages).toHaveLength(0)
    const gone = stubAgent('agent-2')
    const decision = await listener(
      { agent: gone, messages: [], turn: 1, step: 1, signal: new AbortController().signal } as never,
      () => Promise.resolve({ kind: 'enter', messages: [] }),
    )
    expect(decision.kind === 'enter' && decision.messages).toHaveLength(0)
  })

  it('passes a rejection through untouched', async () => {
    const agent = stubAgent('agent-1')
    const listener = harness(agent)['agent/pre-step']
    const decision = await listener(
      { agent, messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'reject' }),
    )
    expect(decision).toEqual({ kind: 'reject' })
  })
})
