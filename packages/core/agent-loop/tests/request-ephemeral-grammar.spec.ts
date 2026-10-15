/**
 * Ephemeral request grammar: per-request grammar fields (`structuredOutput`,
 * `toolChoice`) must never persist into a session's `request/header`, and a
 * later request's seed must never inherit them. Before this contract, one
 * quiet/tools-style contribution permanently polluted every later request —
 * including after the writer abstained — because the seed came from the
 * durable header, and abstention could not retract a seed-carried field.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'

import AgentLoop, { EPHEMERAL_CONFIG_FIELDS } from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from './mock-adapter.ts'

const GRAMMAR = {
  structuredOutput: { type: 'object', properties: {}, additionalProperties: false, strict: true },
  toolChoice: 'auto',
} as const

async function harness(adapter: MockAdapter) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: 'stable base' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
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

function send(agent: Agent, text: string) {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** MockAdapter with a grammar-capable route; the llm runtime otherwise strips per-request grammar fields before the wire. */
class CapableAdapter extends MockAdapter {
  override structuredOutputOnRequest = true
  override toolChoiceOnRequest = true
}

/** Attach quiet/tools-style grammar to every request, returning the disposer. */
function attachGrammar(ctx: Context): () => void {
  return ctx.on('agent/request', async (_payload, next): Promise<LlmCallConfig> => ({
    ...(await next()),
    structuredOutput: GRAMMAR.structuredOutput,
    toolChoice: GRAMMAR.toolChoice,
  }))
}

describe('ephemeral request grammar', () => {
  it('grammar rides the wire but never the durable header, and stops when the writer stops', async () => {
    const adapter = new CapableAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    const disposeGrammar = attachGrammar(ctx)
    const agent = await ctx.agentLoop.create(SessionId('ephemeral-shape'), { provider: 'mock', model: 'mock' })

    send(agent, 'first')
    await waitForIdle(ctx, agent)

    // The live request carries the contribution's grammar…
    expect(adapter.requests[0]!.toolChoice).toBe(GRAMMAR.toolChoice)
    expect(adapter.requests[0]!.structuredOutput).toMatchObject({ type: 'object' })

    // …while no persisted header does.
    const headerEvents = agent.session.snapshotEvents().filter(event => event.type === 'request/header')
    expect(headerEvents.length).toBeGreaterThan(0)
    for (const event of headerEvents) {
      for (const field of EPHEMERAL_CONFIG_FIELDS) {
        expect((event.data as unknown as { header: { config: Record<string, unknown> } }).header.config[field]).toBeUndefined()
      }
    }

    // The writer stops writing (e.g. the user flips a shape off): the very
    // next request must be clean. Re-seeding from the durable header must
    // never reintroduce the grammar.
    disposeGrammar()
    send(agent, 'second')
    await waitForIdle(ctx, agent)
    for (const field of EPHEMERAL_CONFIG_FIELDS) {
      expect(adapter.requests[1]?.[field]).toBeUndefined()
    }
  })

  it('heals a session whose log carries a pre-fix dirty header', async () => {
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    const ctx = await harness(adapter)
    const agent = await ctx.agentLoop.create(SessionId('heal-dirty-header'), { provider: 'mock', model: 'mock' })

    send(agent, 'first')
    await waitForIdle(ctx, agent)
    for (const field of EPHEMERAL_CONFIG_FIELDS) {
      expect(adapter.requests[0]?.[field]).toBeUndefined()
    }

    // Poison the log exactly the way the pre-fix loop did: a durable header
    // that records per-request grammar as if it were session intent.
    agent.session.append('request/header', {
      header: {
        config: {
          provider: 'mock',
          model: 'mock',
          structuredOutput: GRAMMAR.structuredOutput,
          toolChoice: GRAMMAR.toolChoice,
        },
      },
      reason: 'resume',
    })

    send(agent, 'second')
    await waitForIdle(ctx, agent)
    for (const field of EPHEMERAL_CONFIG_FIELDS) {
      expect(adapter.requests[1]?.[field]).toBeUndefined()
    }
  })
})
