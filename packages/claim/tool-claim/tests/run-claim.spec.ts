import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import ClaimService from '@deepseek-ai/dsh-claim'
import { ClaimId } from '@deepseek-ai/dsh-claim'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import { apply } from '@deepseek-ai/dsh-tool-claim'

/** One scripted executor result, or a rejection to model an infrastructure failure. */
interface ShellScript {
  readonly result?: Partial<ShellRunResult>
  readonly reject?: Error
}

/** Build a registry-compatible agent whose steering is observable. */
function stubAgent(ctx: Context): Agent {
  const session = ctx.sessions.create(SessionId(`run-claim-test-${Math.random()}`))
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

async function harness(scripts: readonly ShellScript[], config: { evidenceLines?: number } = {}) {
  const host = new Context()
  await host.plugin(SessionStore)
  await host.plugin(SessionProjectionRegistry)
  await host.plugin(AgentRegistry)
  host.sessionProjections.register(turnBoundaryProjectionDefinition)
  await host.plugin(ClaimService)
  const agent = stubAgent(host)
  host.agents.register(agent)
  agent.session.append('turn/start', { turn: 1 })

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

  const registered: { name: string; execute: (args: never, exec: never) => Promise<unknown> }[] = []
  const pluginCtx = {
    systemPrompt: { section: () => {}, getSectionOrder: () => 2450 },
    tools: { register: (tool: { name: string; execute: (args: never, exec: never) => Promise<unknown> }) => { registered.push(tool) } },
    agents: host.agents,
    claims: host.claims,
    sessionProjections: host.sessionProjections,
    shell,
    on: () => {},
  }
  apply(pluginCtx as never, config)
  const runClaim = registered.find(tool => tool.name === 'run_claim')
  /* v8 ignore next -- apply always registers run_claim */
  if (runClaim === undefined) throw new Error('run_claim was not registered')
  const exec = { agent, signal: new AbortController().signal }
  return {
    ctx: host,
    agent,
    run: (id: string) => runClaim.execute({ id } as never, exec as never),
  }
}

describe('run_claim', () => {
  it('settles the claim as passed when the verifier exits zero', async () => {
    const { ctx, agent, run } = await harness([{ result: { exitCode: 0 } }])
    const claim = ctx.claims.declare(agent, { title: 'prove', description: 'tests pass', script: 'exit 0' })
    const value = await run(claim.id) as { claim: { outcome: string; settlement: string; evidence: string } }
    expect(value.claim).toMatchObject({ id: claim.id, outcome: 'pass', settlement: 'passed' })
    expect(ctx.claims.ledger(agent)[0]?.settlement).toEqual({ kind: 'passed' })
  })

  it('records a failure with bounded evidence, keeps the claim open, and unblocks abandon', async () => {
    const lines = Array.from({ length: 5 }, (_, index) => `line-${index}`)
    const { ctx, agent, run } = await harness(
      [{ result: { exitCode: 1, stdout: { text: lines.join('\n'), truncated: false } } }],
      { evidenceLines: 2 },
    )
    const claim = ctx.claims.declare(agent, { title: 'prove', description: 'tests pass', script: 'exit 1' })
    const value = await run(claim.id) as { claim: { outcome: string; settlement: string; evidence: string } }
    expect(value.claim.outcome).toBe('fail')
    expect(value.claim.settlement).toBe('pending')
    expect(value.claim.evidence).toBe('line-3\nline-4')
    expect(ctx.claims.openClaims(agent)).toHaveLength(1)
    expect(ctx.claims.abandon(agent, ClaimId(claim.id), 'the condition was wrong'))
      .toMatchObject({ settlement: { kind: 'blocked', code: 'abandoned' } })
  })

  it('leaves an inconclusive run pending without settling', async () => {
    const { ctx, agent, run } = await harness([{ result: { timedOut: true } }])
    const claim = ctx.claims.declare(agent, { title: 'prove', description: 'x', script: 'exit 0' })
    const value = await run(claim.id) as { claim: { outcome: string; settlement: string } }
    expect(value.claim.outcome).toBe('inconclusive')
    expect(value.claim.settlement).toBe('pending')
    expect(ctx.claims.openClaims(agent)).toHaveLength(1)
  })

  it('settles a tampered binding immediately', async () => {
    const { ctx, agent, run } = await harness([{ result: { exitCode: 0 } }])
    agent.session.append('claim/declared', {
      id: ClaimId(randomUUID()),
      turn: 1,
      revision: 1,
      title: 'prove',
      description: 'x',
      verifier: { source: 'exit 0', digest: 'deadbeef' },
    })
    const claim = ctx.claims.ledger(agent)[0]!
    const value = await run(claim.id) as { claim: { outcome: string; settlement: string } }
    expect(value.claim.outcome).toBe('tampered')
    expect(value.claim.settlement).toBe('tampered')
  })

  it('rejects an id that is not an open claim of this turn', async () => {
    const { ctx, agent, run } = await harness([{ result: { exitCode: 0 } }])
    ctx.claims.declare(agent, { title: 'prove', description: 'x', script: 'exit 0' })
    await expect(run(randomUUID())).rejects.toThrow('is not an open claim of this turn')
  })
})
