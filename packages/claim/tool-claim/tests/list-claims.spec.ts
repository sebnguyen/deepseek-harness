import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import ClaimService from '@deepseek-ai/dsh-claim'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { apply } from '@deepseek-ai/dsh-tool-claim'

/** Build a registry-compatible agent around one fresh session. */
function stubAgent(ctx: Context): Agent {
  const session = ctx.sessions.create(SessionId(`list-claims-test-${Math.random()}`))
  return {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx,
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject() {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

async function harness() {
  const host = new Context()
  await host.plugin(SessionStore)
  await host.plugin(SessionProjectionRegistry)
  await host.plugin(AgentRegistry)
  host.sessionProjections.register(turnBoundaryProjectionDefinition)
  await host.plugin(ClaimService)
  const agent = stubAgent(host)
  host.agents.register(agent)
  agent.session.append('turn/start', { turn: 1 })

  const registered: { name: string; execute: (args: never, exec: never) => Promise<unknown> }[] = []
  const pluginCtx = {
    systemPrompt: { section: () => {}, getSectionOrder: () => 2450 },
    tools: { register: (tool: { name: string; execute: (args: never, exec: never) => Promise<unknown> }) => { registered.push(tool) } },
    agents: host.agents,
    claims: host.claims,
    sessionProjections: host.sessionProjections,
    shell: {},
    on: () => {},
    get: () => undefined,
  }
  apply(pluginCtx as never)
  const listClaims = registered.find(tool => tool.name === 'list_claims')
  /* v8 ignore next -- apply always registers list_claims */
  if (listClaims === undefined) throw new Error('list_claims was not registered')
  const exec = { agent, signal: new AbortController().signal }
  return {
    ctx: host,
    agent,
    list: (override?: unknown) => listClaims.execute({} as never, (override ?? exec) as never),
  }
}

describe('list_claims', () => {
  it('lists this turn\'s claims in declaration order, pending or settled', async () => {
    const { ctx, agent, list } = await harness()
    const passed = ctx.claims.declare(agent, { title: 'tests pass', description: 'the suite is green', script: 'exit 0' })
    ctx.claims.settle(agent, passed.id, { kind: 'passed' })
    const pending = ctx.claims.declare(agent, { title: 'lint clean', description: 'lint exits zero', script: 'exit 0' })
    const value = await list() as { claims: { id: string; title: string; description: string; settlement: string }[] }
    expect(value.claims).toEqual([
      { id: passed.id, title: 'tests pass', description: 'the suite is green', settlement: 'passed' },
      { id: pending.id, title: 'lint clean', description: 'lint exits zero', settlement: 'pending' },
    ])
  })

  it('returns an empty roster when the open turn declared nothing', async () => {
    const { ctx, agent, list } = await harness()
    ctx.claims.declare(agent, { title: 'earlier', description: 'an earlier turn', script: 'exit 0' })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    agent.session.append('turn/start', { turn: 2 })
    expect(await list()).toEqual({ claims: [] })
  })

  it('rejects a call without the exact live calling agent', async () => {
    const { list } = await harness()
    await expect(list({ signal: new AbortController().signal })).rejects.toThrow('require a calling agent')
    const stranger = { id: 'stranger', session: { id: 'stranger' } }
    await expect(list({ agent: stranger, signal: new AbortController().signal }))
      .rejects.toThrow('require the exact live calling agent')
  })
})
