/**
 * The Host-side paged job read: what a detail view calls when it opens late or
 * pages back, and the failures a caller may not read through.
 */

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId } from '@deepseek-ai/dsh-jobs'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import SessionStore, { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it } from 'vitest'
import { JOB_OUTPUT_PAGE_LINES, readJobOutput } from '../src/job-output.ts'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

/** A producer whose retained window the test dictates. */
function producer(lines: string[], first = 0) {
  let settle!: (outcome: JobOutcome) => void
  return {
    spec: {
      kind: 'bash' as const,
      label: 'tail',
      run: () => ({
        cancel: () => {},
        done: new Promise<JobOutcome>((resolve) => { settle = resolve }),
        readLines: (from: number) => ({
          lines: lines.slice(Math.max(from - first, 0)),
          next: first + lines.length,
          truncated: from < first,
        }),
      }),
    },
    settle: (outcome: JobOutcome) => { settle(outcome) },
  }
}

async function harness(): Promise<{ ctx: Context; session: Session; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry)
  ctx.jobs.attachController('job-output-test')
  const session = Session.create(SessionId('page-source'), [], {
    version: SESSION_FORMAT_VERSION, id: SessionId('page-source'), createdAt: 0, isSeeded: false,
  })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx,
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(agent)
  return { ctx, session, agent }
}

describe('Host paged job output', () => {
  it('serves retained lines from an absolute index and says where to continue', async () => {
    const { ctx, session, agent } = await harness()
    const task = producer(['one', 'two', 'three'])
    const id = ctx.jobs.start({ ...task.spec, owner: agent })

    // A cold view starts at the oldest retained line.
    expect(readJobOutput(ctx, { sessionId: session.id, jobId: id })).toEqual({
      lines: ['one', 'two', 'three'], next: 3, truncated: false, addressable: true,
    })
    // Paging back to a line the producer still retains continues from there.
    expect(readJobOutput(ctx, { sessionId: session.id, jobId: id, from: 1 })).toEqual({
      lines: ['two', 'three'], next: 3, truncated: false, addressable: true,
    })
    // Caught up: nothing new, and `next` stays where the caller already is.
    expect(readJobOutput(ctx, { sessionId: session.id, jobId: id, from: 3 })).toEqual({
      lines: [], next: 3, truncated: false, addressable: true,
    })

  })

  it('bounds one page and lets the caller continue from where it stopped', async () => {
    const { ctx, session, agent } = await harness()
    const lines = Array.from({ length: JOB_OUTPUT_PAGE_LINES + 120 }, (_, index) => `line-${String(index)}`)
    const id = ctx.jobs.start({ ...producer(lines).spec, owner: agent })

    const page = readJobOutput(ctx, { sessionId: session.id, jobId: id })
    expect(page.lines).toHaveLength(JOB_OUTPUT_PAGE_LINES)
    expect(page.next).toBe(JOB_OUTPUT_PAGE_LINES)
    const rest = readJobOutput(ctx, { sessionId: session.id, jobId: id, from: page.next })
    expect(rest.lines).toHaveLength(120)
    expect(rest.next).toBe(lines.length)
    expect([...page.lines, ...rest.lines]).toEqual(lines)

  })

  it('reports a producer with no addressable buffer instead of an empty page', async () => {
    const { ctx, session, agent } = await harness()
    const finished = producer([])
    const id = ctx.jobs.start({
      ...finished.spec,
      owner: agent,
      run: () => ({
        cancel: () => {},
        done: new Promise<JobOutcome>(() => {}),
        readOutput: () => 'streamed',
      }),
    })

    expect(readJobOutput(ctx, { sessionId: session.id, jobId: id })).toEqual({
      lines: [], next: 0, truncated: false, addressable: false,
    })

  })

  it('re-anchors past a gap the producer reports', async () => {
    const { ctx, session, agent } = await harness()
    // The retained window now starts at line 40, so a cursor at 10 is stale.
    const id = ctx.jobs.start({ ...producer(['kept-a', 'kept-b'], 40).spec, owner: agent })

    expect(readJobOutput(ctx, { sessionId: session.id, jobId: id, from: 10 })).toEqual({
      lines: ['kept-a', 'kept-b'], next: 42, truncated: true, addressable: true,
    })

  })

  it('refuses a session with no live agent, an unreadable job, and a bad cursor', async () => {
    const { ctx, session, agent } = await harness()
    const id = ctx.jobs.start({ ...producer(['secret']).spec, owner: agent })
    const attempt = (request: Parameters<typeof readJobOutput>[1]) =>
      Promise.resolve().then(() => readJobOutput(ctx, request)).catch((error: unknown) => error)

    expect(remoteErrorOf(await attempt({ sessionId: SessionId('cold'), jobId: id }))).toMatchObject({
      code: 'session/not-found',
      details: { sessionId: 'cold' },
    })
    // A job nobody owns is the same answer as one owned by another Session: a
    // caller that may not read it learns nothing about why.
    expect(remoteErrorOf(await attempt({ sessionId: session.id, jobId: JobId('bash-404') }))).toMatchObject({
      code: 'session/job-not-found',
      details: { sessionId: session.id, jobId: 'bash-404' },
    })
    expect(remoteErrorOf(await attempt({ sessionId: session.id, jobId: id, from: -1 })))
      .toMatchObject({ code: 'gateway/bad-request' })
  })
})
