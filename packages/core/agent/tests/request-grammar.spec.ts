import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import {
  agentEvents,
  GRAMMAR_PRIORITY,
  RequestGrammarService,
  type Agent,
} from '../src/index.ts'

const SIGNAL = new AbortController().signal

function createAgent(name: string): Agent {
  return { id: SessionId(name), session: Session.create(SessionId(name)) } as Agent
}

describe('RequestGrammarService', () => {
  it('folds contributions in priority order regardless of registration order', async () => {
    const ctx = new Context()
    const service = new RequestGrammarService(ctx)
    const agent = createAgent('grammar-fold')
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed' }
    const shield = { type: 'object' as const, properties: {}, additionalProperties: false }
    const schema = { type: 'object' as const, properties: { handoff: { type: 'string' as const } }, required: ['handoff'] }

    // Register the high-priority writer first: wiring order must not matter.
    service.contribute({
      id: 'capture-driver',
      priority: GRAMMAR_PRIORITY.structuredOutputDriver,
      attach: () => ({ structuredOutput: schema }),
    })
    service.contribute({
      id: 'turn-shape',
      priority: GRAMMAR_PRIORITY.turnShape,
      attach: () => ({ structuredOutput: shield }),
    })

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL }, () => Promise.resolve(seed),
    )).resolves.toEqual({ provider: 'seed', model: 'seed', structuredOutput: schema })
  })

  it('returns the seed untouched when every contribution abstains', async () => {
    const ctx = new Context()
    const service = new RequestGrammarService(ctx)
    const agent = createAgent('grammar-abstain')
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed' }

    service.contribute({
      id: 'abstainer',
      priority: GRAMMAR_PRIORITY.turnShape,
      attach: () => undefined,
    })

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)
  })

  it('scopes contributions per draft.agent and disposes them deterministically', async () => {
    const ctx = new Context()
    const service = new RequestGrammarService(ctx)
    const child = createAgent('grammar-child')
    const other = createAgent('grammar-other')
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed' }
    const schema = { type: 'object' as const, properties: { mark: { type: 'string' as const } } }

    const dispose = service.contribute({
      id: `scoped:${child.id}`,
      priority: GRAMMAR_PRIORITY.structuredOutputDriver,
      attach: ({ agent }) => agent.id === child.id ? { structuredOutput: schema } : undefined,
    })

    await expect(agentEvents(ctx, child).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL }, () => Promise.resolve(seed),
    )).resolves.toEqual({ provider: 'seed', model: 'seed', structuredOutput: schema })
    await expect(agentEvents(ctx, other).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)

    dispose()
    await expect(agentEvents(ctx, child).waterfall(
      'agent/request', { turn: 1, step: 2, signal: SIGNAL }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)
  })

  it('rejects a duplicate contribution id loudly', () => {
    const ctx = new Context()
    const service = new RequestGrammarService(ctx)
    const attach = () => undefined
    service.contribute({ id: 'singleton', priority: GRAMMAR_PRIORITY.turnShape, attach })
    expect(() => service.contribute({ id: 'singleton', priority: GRAMMAR_PRIORITY.turnShape, attach }))
      .toThrow(/already registered/)
  })

  it('orders toolChoice the same way, staging above turn shape', async () => {
    const ctx = new Context()
    const service = new RequestGrammarService(ctx)
    const agent = createAgent('grammar-tool-choice')
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed' }

    service.contribute({
      id: 'shape-choice',
      priority: GRAMMAR_PRIORITY.turnShape,
      attach: () => ({ toolChoice: 'none' as const }),
    })
    service.contribute({
      id: 'staging-choice',
      priority: GRAMMAR_PRIORITY.staging,
      attach: () => ({ toolChoice: 'required' as const }),
    })

    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL }, () => Promise.resolve(seed),
    )).resolves.toEqual({ provider: 'seed', model: 'seed', toolChoice: 'required' })
  })
})
