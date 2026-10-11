import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { agentEvents, GRAMMAR_PRIORITY, RequestGrammarService, type Agent } from '@deepseek-ai/dsh-agent'

const SIGNAL = new AbortController().signal

class StubAdapter extends LlmAdapter {
  override readonly structuredOutputOnRequest = true
  async *stream(): AsyncIterableIterator<never> { /* empty */ }
}

describe('probe', () => {
  it('fold delivers a contribution patch', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test-route'], new StubAdapter())
    const service = new RequestGrammarService(ctx)
    service.contribute({
      id: 'probe',
      priority: GRAMMAR_PRIORITY.turnShape,
      attach: () => ({ structuredOutput: { type: 'object' } }),
    })
    const agent = { id: SessionId('p'), session: Session.create(SessionId('p')) } as Agent
    console.log('capability:', ctx.llm.grammarCapability('test-route', 'test-model'))
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL },
      () => Promise.resolve({ provider: 'test-route', model: 'test-model' }),
    )).resolves.toEqual({ provider: 'test-route', model: 'test-model', structuredOutput: { type: 'object' } })
  })
})
