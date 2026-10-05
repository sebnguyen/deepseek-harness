/**
 * The `sessionCost` projection unit: mounting the plugin with `pricing`
 * registers the key and prices provider usage under the configured rates;
 * without `pricing` the key is absent (cost is opt-in deployment policy);
 * malformed `usage` never poisons the fold; unmounting removes the key.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionStatsPlugin from '@deepseek-ai/dsh-session-stats'
import { sessionCostProjectionDefinition } from '@deepseek-ai/dsh-session-stats/src/cost-projection.ts'
import type { SessionCostProjection } from '@deepseek-ai/dsh-session-stats/types'

const RATES = {
  inputPerMillionUsd: 0.5,
  outputPerMillionUsd: 2,
  cacheReadPerMillionUsd: 0.1,
  cacheWritePerMillionUsd: 0.6,
}

async function harness(config?: { pricing?: typeof RATES }): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionStatsPlugin, config)
  return { ctx, session: ctx.sessions.create(SessionId('priced')) }
}

function appendUsageMessage(session: Session, usage: TokenUsage | undefined): void {
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    ...usage !== undefined ? { usage } : {},
    message: createMessage({
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
}

describe('sessionCost projection', () => {
  it('is absent without pricing config', async () => {
    const { ctx, session } = await harness()
    const { values } = ctx.sessionProjections.snapshot(session)
    expect(values.sessionCost).toBeUndefined()
  })

  it('prices the four provider buckets under the configured rates', async () => {
    const { ctx, session } = await harness({ pricing: RATES })
    session.append('turn/start', { turn: 1 })
    appendUsageMessage(session, {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 2_000_000,
      cacheWriteTokens: 250_000,
    })
    const cost = ctx.sessionProjections.snapshot(session).values.sessionCost as SessionCostProjection
    expect(cost).toMatchObject({
      uncachedInputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 2_000_000,
      cacheWriteTokens: 250_000,
      // 1M*0.5 + 0.5M*2 + 2M*0.1 + 0.25M*0.6 = 0.5 + 1 + 0.2 + 0.15 = $1.85
      costMicros: 1_850_000,
      rates: {
        fallback: RATES,
        models: {},
      },
    })
    // The single message logged model 'mock', absent from the rate map, so
    // its spend entry rides the fallback rates under that key.
    expect(cost.perModel).toEqual({
      mock: {
        uncachedInputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 2_000_000,
        cacheWriteTokens: 250_000,
        costMicros: 1_850_000,
      },
    })
  })

  it('accumulates across messages and skips ones without usage', async () => {
    const { ctx, session } = await harness({ pricing: RATES })
    session.append('turn/start', { turn: 1 })
    appendUsageMessage(session, { inputTokens: 1000, outputTokens: 10 })
    appendUsageMessage(session, undefined)
    appendUsageMessage(session, { inputTokens: 500, outputTokens: 5 })
    const cost = ctx.sessionProjections.snapshot(session).values.sessionCost as SessionCostProjection
    expect(cost.uncachedInputTokens).toBe(1500)
    expect(cost.outputTokens).toBe(15)
    expect(cost.costMicros).toBe(Math.round(1500 * 0.5 + 15 * 2))
  })

  it('folds the definition directly on controlled events', () => {
    const definition = sessionCostProjectionDefinition(RATES)
    let state = definition.init({} as never, 0 as never)
    state = definition.apply(state, {
      type: 'assistant/message',
      data: { usage: { inputTokens: 10, outputTokens: 4 } },
      time: 0,
    } as never)
    expect(state.costMicros).toBe(Math.round(10 * 0.5 + 4 * 2))
    // A message without a logged model accumulates under the empty key.
    expect(state.perModel['']).toMatchObject({ uncachedInputTokens: 10, costMicros: Math.round(10 * 0.5 + 4 * 2) })
    // A malformed usage leaves the fold untouched.
    const unchanged = definition.apply(state, {
      type: 'assistant/message',
      data: { usage: { inputTokens: -5, outputTokens: 1 } },
      time: 0,
    } as never)
    expect(unchanged).toBe(state)
  })

  it('prices each message under its logged model rate and fails loud on bad entries', () => {
    const definition = sessionCostProjectionDefinition({
      ...RATES,
      models: {
        'qwen3.8-max': { inputPerMillionUsd: 2, outputPerMillionUsd: 6, cacheReadPerMillionUsd: 0, cacheWritePerMillionUsd: 0 },
      },
    })
    expect(definition.init({} as never, 0 as never).rates.models['qwen3.8-max']).toMatchObject({ inputPerMillionUsd: 2 })
    const message = (model: string) => ({
      type: 'assistant/message',
      data: { usage: { inputTokens: 1_000_000, outputTokens: 0 }, message: { source: { provider: 'digitalocean', model } } },
      time: 0,
    } as never)
    let state = definition.init({} as never, 0 as never)
    state = definition.apply(state, message('qwen3.8-max'))
    state = definition.apply(state, message('other-route'))
    // 1M at the model rate plus 1M at the flat fallback.
    expect(state.costMicros).toBe(2_000_000 + Math.round(1_000_000 * 0.5))
    // Each logged model keeps its own spend entry; the undeclared route
    // prices under the fallback rates but keys by its own id.
    expect(state.perModel['qwen3.8-max']?.costMicros).toBe(2_000_000)
    expect(state.perModel['other-route']?.costMicros).toBe(Math.round(1_000_000 * 0.5))
    expect(() => sessionCostProjectionDefinition({
      ...RATES,
      models: { broken: { inputPerMillionUsd: -1 } },
    } as never)).toThrow(/pricing\.models\.broken/)
  })

  it('removes the key when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const registry = ctx.sessionProjections
    const dispose = registry.register(sessionCostProjectionDefinition(RATES))
    const session = ctx.sessions.create(SessionId('gone'))
    session.append('turn/start', { turn: 1 })
    expect(registry.snapshot(session).values.sessionCost).toBeDefined()
    dispose()
    expect(registry.snapshot(session).values.sessionCost).toBeUndefined()
  })
})
