import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as ClaimInvariantCompanion from '@deepseek-ai/dsh-claim/invariant'
import type { ClaimId } from '@deepseek-ai/dsh-claim'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'

const claimId = 'claim-invariant-1' as ClaimId

const declared = {
  id: claimId,
  turn: 1,
  revision: 1,
  title: 'hold the stream',
  description: 'the stream holds',
  verifier: { source: 'exit 0', digest: 'abc' },
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ClaimInvariantCompanion)
  return ctx
}

/** The failure shape the invariant reporter raises for this package. */
const claimInvariantFailure = expect.objectContaining<Partial<InvariantError>>({
  code: 'INVARIANT',
  packageName: '@deepseek-ai/dsh-claim',
})

describe('claim stream invariants', () => {
  it('accepts a claim declared and settled inside one open turn', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('claim-invariant-valid'))
    session.append('turn/start', { turn: 1 })
    session.append('claim/declared', declared)
    session.append('claim/result', { id: claimId, turn: 1, revision: 2, outcome: 'fail', evidence: 'boom' })
    session.append('claim/settled', { id: claimId, turn: 1, revision: 3, settlement: { kind: 'blocked', code: 'abandoned', message: 'wrong' } })
    expect(() => {
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()
  })

  it('rejects a turn ending with an unsettled claim', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('claim-invariant-unsettled'))
    session.append('turn/start', { turn: 1 })
    session.append('claim/declared', declared)
    expect(() => {
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).toThrow(claimInvariantFailure)
  })

  it('rejects a claim record appended outside any open turn', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('claim-invariant-no-turn'))
    expect(() => {
      session.append('claim/declared', declared)
    }).toThrow(claimInvariantFailure)
    expect(session.seq).toBe(0)
  })

  it('accepts two declarations in the same turn and requires both to settle', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('claim-invariant-double'))
    const secondId = 'claim-invariant-2' as ClaimId
    session.append('turn/start', { turn: 1 })
    session.append('claim/declared', declared)
    session.append('claim/declared', { ...declared, id: secondId })
    // Ending the turn while either claim is still open fails.
    expect(() => {
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).toThrow(claimInvariantFailure)
  })

  it('rejects a malformed outcome before committing the event and stays reusable', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('claim-invariant-malformed'))
    session.append('turn/start', { turn: 1 })
    session.append('claim/declared', declared)
    expect(() => {
      session.append('claim/result', { id: claimId, turn: 1, revision: 2, outcome: 'maybe', evidence: 'x' } as never)
    }).toThrow(claimInvariantFailure)
    expect(() => {
      session.append('claim/result', { id: claimId, turn: 1, revision: 2, outcome: 'fail', evidence: 'x' })
    }).not.toThrow()
  })

  it('rejects a claim record that names a different turn than the open one', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('claim-invariant-wrong-turn'))
    session.append('turn/start', { turn: 1 })
    expect(() => {
      session.append('claim/declared', { ...declared, turn: 2 })
    }).toThrow(claimInvariantFailure)
    expect(session.seq).toBe(1)
  })
})
