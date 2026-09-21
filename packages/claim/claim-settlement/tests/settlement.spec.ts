import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import ClaimService, { ClaimId } from '@deepseek-ai/dsh-claim'
import { apply } from '@deepseek-ai/dsh-claim-settlement'
import type { Config } from '@deepseek-ai/dsh-claim-settlement'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'

type TurnStopping = (payload: { agent: Agent; turn: number; signal: AbortSignal }) => Promise<void>

/** One scripted executor result, or a rejection to model an infrastructure failure. */
interface ShellScript {
  readonly result?: Partial<ShellRunResult>
  readonly reject?: Error
}

/** Build a registry-compatible agent whose steering is observable. */
function stubAgent(ctx: Context, steers: string[]): Agent {
  const session = ctx.sessions.create(SessionId(`settle-test-${Math.random()}`))
  return {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx,
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: (message) => {
      const text = message.content.map(block => block.type === 'text' ? block.text : '').join('')
      steers.push(text)
    },
    inject() {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

async function harness(
  scripts: readonly ShellScript[],
  config: Config = {},
) {
  const host = new Context()
  await host.plugin(SessionStore)
  await host.plugin(SessionProjectionRegistry)
  await host.plugin(AgentRegistry)
  host.sessionProjections.register(turnBoundaryProjectionDefinition)
  await host.plugin(ClaimService)
  const steers: string[] = []
  const agent = stubAgent(host, steers)
  host.agents.register(agent)

  let index = 0
  const shell = {
    resolve: (request: unknown) => request,
    run: async (): Promise<ShellRunResult> => {
      const script = scripts[Math.min(index, scripts.length - 1)]
      index += 1
      if (script?.reject !== undefined) throw script.reject
      return { exitCode: 0, signal: null, timedOut: false, stdout: { text: '', truncated: false }, ...script?.result } as ShellRunResult
    },
  }

  let handler: TurnStopping | undefined
  const pluginCtx = {
    on: (_name: string, listener: TurnStopping) => { handler = listener },
    claims: host.claims,
    agents: host.agents,
    shell,
  }
  apply(pluginCtx as unknown as Context, config)
  /* v8 ignore next -- apply always registers the turn-stopping listener */
  if (handler === undefined) throw new Error('the settlement listener was not registered')
  return {
    ctx: host,
    agent,
    steers,
    startTurn: (turn: number) => { agent.session.append('turn/start', { turn }) },
    settle: () => handler!({ agent, turn: 1, signal: new AbortController().signal }),
  }
}

describe('claim settlement', () => {
  it('settles passed when the verifier exits zero', async () => {
    const { ctx, agent, steers, settle, startTurn } = await harness([{ result: { exitCode: 0 } }])
    startTurn(1)
    ctx.claims.declare(agent, { title: 'prove', description: 'tests pass', script: 'exit 0' })
    await settle()
    expect(ctx.claims.ledger(agent)[0]?.settlement).toEqual({ kind: 'passed' })
    expect(steers).toEqual([])
  })

  it('steers the failure back while repair budget remains', async () => {
    const { ctx, agent, steers, settle, startTurn } = await harness([{ result: { exitCode: 1, stdout: { text: 'boom', truncated: false } } }])
    startTurn(1)
    ctx.claims.declare(agent, { title: 'prove', description: 'tests pass', script: 'exit 1' })
    await settle()
    const claim = ctx.claims.openClaims(agent)[0]
    expect(claim?.settlement).toEqual({ kind: 'pending' })
    expect(claim?.results).toHaveLength(1)
    expect(steers).toHaveLength(1)
    expect(steers[0]).toContain('boom')
    expect(steers[0]).toContain('tests pass')
  })

  it('blocks after the default single repair re-insert and stops steering', async () => {
    const { ctx, agent, steers, settle, startTurn } = await harness([{ result: { exitCode: 1 } }])
    startTurn(1)
    ctx.claims.declare(agent, { title: 'prove', description: 'x', script: 'exit 1' })
    await settle()
    expect(steers).toHaveLength(1)
    expect(steers[0]).toContain('run_claim')
    expect(ctx.claims.openClaims(agent)[0]?.settlement).toEqual({ kind: 'pending' })
    await settle()
    expect(steers).toHaveLength(1)
    expect(ctx.claims.ledger(agent)[0]?.settlement).toMatchObject({
      kind: 'blocked',
      code: 'repair-budget-exhausted',
    })
  })

  it('retries an inconclusive verifier without steering, then blocks', async () => {
    const { ctx, agent, steers, settle, startTurn } = await harness(
      [{ result: { timedOut: true } }],
      { inconclusiveRetries: 1 },
    )
    startTurn(1)
    ctx.claims.declare(agent, { title: 'prove', description: 'x', script: 'exit 0' })
    await settle()
    expect(steers).toEqual([])
    expect(ctx.claims.openClaims(agent)[0]?.settlement).toEqual({ kind: 'pending' })
    await settle()
    expect(steers).toEqual([])
    expect(ctx.claims.ledger(agent)[0]?.settlement).toMatchObject({
      kind: 'blocked',
      code: 'verifier-unavailable',
    })
  })

  it('treats an infrastructure rejection as inconclusive rather than failure', async () => {
    const { ctx, agent, steers, settle, startTurn } = await harness([{ reject: new Error('no shell') }])
    startTurn(1)
    ctx.claims.declare(agent, { title: 'prove', description: 'x', script: 'exit 0' })
    await settle()
    expect(steers).toEqual([])
    expect(ctx.claims.openClaims(agent)[0]?.results[0]?.outcome).toBe('inconclusive')
  })

  it('blocks a durable binding whose script no longer hashes to its digest', async () => {
    const { ctx, agent, steers, settle, startTurn } = await harness([{ result: { exitCode: 0 } }])
    startTurn(1)
    agent.session.append('claim/declared', {
      id: ClaimId(randomUUID()),
      turn: 1,
      revision: 1,
      title: 'prove',
      description: 'x',
      verifier: { source: 'exit 0', digest: 'deadbeef' },
    })
    await settle()
    expect(ctx.claims.ledger(agent)[0]?.settlement).toEqual({ kind: 'tampered' })
    expect(steers).toEqual([])
  })

  it('runs every open claim and aggregates the failures into one steer', async () => {
    const { ctx, agent, steers, settle, startTurn } = await harness([
      { result: { exitCode: 0 } },
      { result: { exitCode: 1, stdout: { text: 'nope', truncated: false } } },
    ])
    startTurn(1)
    const pass = ctx.claims.declare(agent, { title: 'alpha', description: 'passes', script: 'exit 0' })
    const fail = ctx.claims.declare(agent, { title: 'beta', description: 'fails', script: 'exit 1' })
    await settle()
    expect(ctx.claims.ledger(agent).find(c => c.id === pass.id)?.settlement).toEqual({ kind: 'passed' })
    expect(ctx.claims.ledger(agent).find(c => c.id === fail.id)?.settlement).toEqual({ kind: 'pending' })
    expect(steers).toHaveLength(1)
    expect(steers[0]).toContain('alpha')
    expect(steers[0]).toContain('beta')
    expect(steers[0]).toContain('nope')
  })

  it('does nothing when no claim is open', async () => {
    const { ctx, agent, steers, settle } = await harness([{ result: { exitCode: 0 } }])
    await settle()
    expect(ctx.claims.ledger(agent)).toEqual([])
    expect(steers).toEqual([])
  })
})
