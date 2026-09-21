import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import ClaimService, { bindVerifier, ClaimId } from '@deepseek-ai/dsh-claim'
import { Session, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'

/** Build a registry-compatible agent around one fresh session. */
function stubAgent(ctx: Context, rawId: string): Agent {
  const session = ctx.sessions.create(SessionId(rawId))
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
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  await ctx.plugin(ClaimService)
  const agent = stubAgent(ctx, `claim-test-${Math.random()}`)
  ctx.agents.register(agent)
  return {
    ctx,
    agent,
    startTurn: (turn: number) => { agent.session.append('turn/start', { turn }) },
    endTurn: (turn: number) => { agent.session.append('turn/end', { turn, reason: { kind: 'completed' } }) },
  }
}

describe('claim service', () => {
  it('refuses a declaration while no turn is open', async () => {
    const { ctx, agent } = await harness()
    expect(() => ctx.claims.declare(agent, { title: 'ship', description: 'x', script: 'exit 0' }))
      .toThrowError(/open model turn/)
    expect(ctx.claims.ledger(agent)).toEqual([])
  })

  it('opens a pending claim at revision 1 with a hashed verifier', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    const claim = ctx.claims.declare(agent, { title: 'ship the fix', description: 'tests pass', script: 'exit 0' })
    expect(claim.turn).toBe(1)
    expect(claim.revision).toBe(1)
    expect(claim.title).toBe('ship the fix')
    expect(claim.description).toBe('tests pass')
    expect(claim.verifier).toEqual({ source: 'exit 0', digest: bindVerifier('exit 0').digest })
    expect(claim.results).toEqual([])
    expect(claim.settlement).toEqual({ kind: 'pending' })
    expect(ctx.claims.openClaims(agent)).toEqual([claim])
  })

  it('allows multiple claims in the same turn and lists them pending in declaration order', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    const first = ctx.claims.declare(agent, { title: 'first', description: 'a', script: 'exit 0' })
    const second = ctx.claims.declare(agent, { title: 'second', description: 'b', script: 'exit 0' })
    expect(ctx.claims.openClaims(agent)).toEqual([first, second])
    expect(ctx.claims.ledger(agent)).toHaveLength(2)
  })

  it('opens fresh claims in the next turn and keeps the ledger in turn order', async () => {
    const { ctx, agent, startTurn, endTurn } = await harness()
    startTurn(1)
    const first = ctx.claims.declare(agent, { title: 'first', description: 'a', script: 'exit 0' })
    ctx.claims.settle(agent, first.id, { kind: 'passed' })
    endTurn(1)
    startTurn(2)
    const second = ctx.claims.declare(agent, { title: 'second', description: 'b', script: 'exit 0' })
    expect(second.turn).toBe(2)
    expect(ctx.claims.ledger(agent).map(claim => [claim.turn, claim.description]))
      .toEqual([[1, 'a'], [2, 'b']])
    expect(ctx.claims.openClaims(agent)).toEqual([second])
  })

  it('refuses an empty title or description', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    expect(() => ctx.claims.declare(agent, { title: '   ', description: 'x', script: 'exit 0' }))
      .toThrowError(/title/)
    expect(() => ctx.claims.declare(agent, { title: 'x', description: '   ', script: 'exit 0' }))
      .toThrowError(/description/)
  })

  it('refuses an empty verifier script', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    expect(() => ctx.claims.declare(agent, { title: 'x', description: 'y', script: '  ' }))
      .toThrowError(/non-empty string/)
  })

  it('advances the revision and counts failures per claim as results are recorded', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    const claim = ctx.claims.declare(agent, { title: 'fix', description: 'tests pass', script: 'exit 1' })
    const first = ctx.claims.record(agent, claim.id, { outcome: 'fail', evidence: 'boom' })
    expect(first.revision).toBe(2)
    expect(ctx.claims.failures(agent, claim.id)).toBe(1)
    const second = ctx.claims.record(agent, claim.id, { outcome: 'fail', evidence: 'again' })
    expect(second.revision).toBe(3)
    expect(ctx.claims.failures(agent, claim.id)).toBe(2)
    expect(ctx.claims.record(agent, claim.id, { outcome: 'pass', evidence: 'ok' }).results).toHaveLength(3)
  })

  it('refuses to record against a settled claim', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    const claim = ctx.claims.declare(agent, { title: 'x', description: 'y', script: 'exit 0' })
    ctx.claims.settle(agent, claim.id, { kind: 'passed' })
    expect(() => ctx.claims.record(agent, claim.id, { outcome: 'fail', evidence: 'late' }))
      .toThrowError(/already settled/)
  })

  it('refuses to record against an unknown claim id', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    ctx.claims.declare(agent, { title: 'x', description: 'y', script: 'exit 0' })
    expect(() => ctx.claims.record(agent, ClaimId('missing'), { outcome: 'fail', evidence: 'late' }))
      .toThrowError(/does not exist/)
  })

  it('refuses to abandon a claim whose bound verifier has not run', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    const claim = ctx.claims.declare(agent, { title: 'x', description: 'y', script: 'exit 1' })
    expect(() => ctx.claims.abandon(agent, claim.id, 'wrong condition')).toThrowError(/has not run yet/)
  })

  it('abandons once a result exists and settles blocked', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    const claim = ctx.claims.declare(agent, { title: 'x', description: 'y', script: 'exit 1' })
    ctx.claims.record(agent, claim.id, { outcome: 'fail', evidence: 'boom' })
    const settled = ctx.claims.abandon(agent, claim.id, 'the condition named the wrong file')
    expect(settled.settlement).toEqual({
      kind: 'blocked',
      code: 'abandoned',
      message: 'the condition named the wrong file',
    })
  })

  it('settles passed and refuses further records', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    const claim = ctx.claims.declare(agent, { title: 'x', description: 'y', script: 'exit 0' })
    const settled = ctx.claims.settle(agent, claim.id, { kind: 'passed' })
    expect(settled.settlement).toEqual({ kind: 'passed' })
    expect(() => ctx.claims.record(agent, claim.id, { outcome: 'fail', evidence: 'late' }))
      .toThrowError(/already settled/)
  })

  it('rejects a claim operation for an agent that is not the live registry instance', async () => {
    const { ctx, agent } = await harness()
    const impostor = { ...agent, id: agent.id }
    expect(() => ctx.claims.openClaims(impostor)).toThrowError(/not the live registry instance/)
  })

  it('folds a resumed session back to the same ledger', async () => {
    const { ctx, agent, startTurn } = await harness()
    startTurn(1)
    const claim = ctx.claims.declare(agent, { title: 'resume', description: 'resume me', script: 'exit 0' })
    ctx.claims.record(agent, claim.id, { outcome: 'fail', evidence: 'boom' })
    const replayed = Session.create(agent.session.id, agent.session.snapshotEvents())
    const fresh = new Context()
    await fresh.plugin(SessionStore)
    await fresh.plugin(SessionProjectionRegistry)
    await fresh.plugin(AgentRegistry)
    fresh.sessionProjections.register(turnBoundaryProjectionDefinition)
    await fresh.plugin(ClaimService)
    const replayedAgent = { ...agent, session: replayed, ctx: fresh }
    fresh.agents.register(replayedAgent)
    const folded = fresh.claims.ledger(replayedAgent)
    expect(folded).toHaveLength(1)
    expect(folded[0]?.description).toBe('resume me')
    expect(folded[0]?.turn).toBe(1)
    expect(folded[0]?.results).toHaveLength(1)
  })
})
