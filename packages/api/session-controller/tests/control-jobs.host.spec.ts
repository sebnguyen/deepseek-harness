import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import { SessionControlController } from '../src/control.ts'
import type { SessionControlFrame } from '../src/types.ts'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'

type BaselineFrame = Extract<SessionControlFrame, { type: 'baseline' }>
type JobFrame = Extract<SessionControlFrame, { type: 'jobs' }>

function producer(label = 'sleep 60') {
  let settle!: (outcome: JobOutcome) => void
  const reads = { count: 0 }
  const spec = {
    kind: 'bash' as const,
    label,
    run: () => ({
      cancel: () => {},
      done: new Promise<JobOutcome>((resolve) => { settle = resolve }),
      readOutput: () => { reads.count += 1; return 'stolen output' },
    }),
  }
  return { spec, reads, settle: (outcome: JobOutcome) => { settle(outcome) } }
}

async function harness(withJobs: boolean, options: { jobOutputPollMs?: number } = {}): Promise<{
  ctx: Context
  session: Session
  agent: Agent
  control: SessionControlController
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  if (withJobs) {
    await ctx.plugin(LocalJobRegistry)
    ctx.jobs.attachController('session-controller-test')
  }
  const session = ctx.sessions.create()
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
  const control = new SessionControlController(ctx, { jobOutputPollMs: options.jobOutputPollMs ?? 250 })
  await new Promise(resolve => setTimeout(resolve, 0))
  return { ctx, session, agent, control }
}

async function baseline(control: SessionControlController): Promise<BaselineFrame> {
  const abort = new AbortController()
  const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
  const first = await iterator.next()
  abort.abort()
  await iterator.next()
  if (first.done || first.value.type !== 'baseline') throw new Error('missing control baseline')
  return first.value
}

async function collectJobs(
  iterable: AsyncIterable<SessionControlFrame>,
  count: number,
  abort: AbortController,
): Promise<JobFrame[]> {
  const jobs: JobFrame[] = []
  for await (const frame of iterable) {
    if (frame.type !== 'jobs') continue
    jobs.push(frame)
    if (jobs.length >= count) abort.abort()
  }
  return jobs
}

describe('Session control jobs baseline', () => {
  it('represents an attached session with no jobs as an empty set', async () => {
    const { session, control } = await harness(true)
    const frame = await baseline(control)
    expect(frame.value.jobs[session.id]).toEqual([])
  })

  it('carries the visible set when the stream opens', async () => {
    const { ctx, session, agent, control } = await harness(true)
    ctx.jobs.start({ ...producer('pnpm run build').spec, owner: agent })
    const frame = await baseline(control)
    const jobs = frame.value.jobs[session.id]
    expect(jobs).toHaveLength(1)
    const [job] = jobs ?? []
    expect(job?.startedAt).toBeTypeOf('number')
    expect({ ...job, startedAt: 0 }).toEqual({
      id: 'bash-1',
      kind: 'bash',
      label: 'pnpm run build',
      status: 'running',
      startedAt: 0,
    })
  })
})

/** A producer whose retained window the test grows and advances. */
function outputProducer(lines: string[]) {
  let settle!: (outcome: JobOutcome) => void
  const state = { lines, first: 0 }
  const spec = {
    kind: 'bash' as const,
    label: 'tail',
    run: () => ({
      cancel: () => {},
      done: new Promise<JobOutcome>((resolve) => { settle = resolve }),
      // `first` is the absolute index of the oldest retained line: a cursor
      // below it is told lines were dropped rather than being served a shift.
      readLines: (from: number) => ({
        lines: state.lines.slice(Math.max(from - state.first, 0)),
        next: state.first + state.lines.length,
        truncated: from < state.first,
      }),
    }),
  }
  return {
    spec,
    lines: state.lines,
    dropTo: (kept: string[], first: number) => { state.lines = kept; state.first = first },
    settle: (outcome: JobOutcome) => { settle(outcome) },
  }
}

/** Resolve the next jobOutput frame; never settles while publishing is silent. */
async function nextOutputFrame(
  control: SessionControlController,
  abort: AbortController,
): Promise<Extract<SessionControlFrame, { type: 'jobOutput' }>> {
  for await (const frame of control.control(abort.signal)) {
    if (frame.type === 'jobOutput') return frame
  }
  throw new Error('control stream ended before an output frame')
}

/** Collect `count` output frames, aborting the stream once they arrive. */
async function outputFrames(
  iterable: AsyncIterable<SessionControlFrame>,
  count: number,
  abort: AbortController,
): Promise<Extract<SessionControlFrame, { type: 'jobOutput' }>[]> {
  const frames: Extract<SessionControlFrame, { type: 'jobOutput' }>[] = []
  for await (const frame of iterable) {
    if (frame.type !== 'jobOutput') continue
    frames.push(frame)
    if (frames.length >= count) abort.abort()
  }
  return frames
}

/** The stray output frame when one arrives inside the window, otherwise undefined. */
async function strayFrame(
  control: SessionControlController,
  window = 120,
): Promise<Extract<SessionControlFrame, { type: 'jobOutput' }> | undefined> {
  const abort = new AbortController()
  const result = await Promise.race([
    nextOutputFrame(control, abort),
    new Promise<undefined>(resolve => setTimeout(() => { resolve(undefined) }, window)),
  ])
  abort.abort()
  return result
}

describe('Session control jobs updates', () => {
  it('publishes existing unowned jobs when a Session attaches after the stream opens', async () => {
    const { ctx, control } = await harness(true)
    const abort = new AbortController()
    const iterator = control.control(abort.signal)[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'baseline' } })
    const task = producer('already running')
    const id = ctx.jobs.start(task.spec)
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'jobs' } })

    const created = ctx.sessions.create(SessionId('late-session'))
    await expect(iterator.next()).resolves.toMatchObject({
      value: {
        type: 'jobs',
        sessionId: created.id,
        jobs: [expect.objectContaining({ id, label: 'already running' })],
      },
    })

    task.settle({ status: 'completed' })
    abort.abort()
    await iterator.return?.()
  })

  it('pushes the owner whole set on registration, stopping, and settlement', async () => {
    const { ctx, session, agent, control } = await harness(true)
    const abort = new AbortController()
    const collected = collectJobs(control.control(abort.signal), 3, abort)

    const task = producer()
    const id = ctx.jobs.start({ ...task.spec, owner: agent })
    ctx.jobs.kill(id, agent, 'test')
    task.settle({ status: 'killed', detail: 'signal: SIGTERM' })

    const frames = await collected
    expect(frames.map(frame => frame.sessionId)).toEqual([session.id, session.id, session.id])
    expect(frames.map(frame => frame.jobs[0]?.status)).toEqual(['running', 'stopping', 'killed'])
    expect(frames[2]?.jobs[0]?.detail).toBe('signal: SIGTERM')
    expect(frames[2]?.jobs[0]?.finishedAt).toBeTypeOf('number')
  })

  it('drops internal registry fields from the browser view', async () => {
    const { ctx, agent, control } = await harness(true)
    const abort = new AbortController()
    const collected = collectJobs(control.control(abort.signal), 1, abort)
    ctx.jobs.start({ ...producer().spec, owner: agent, outputLimitBytes: 1_024 })

    const [frame] = await collected
    expect(Object.keys(frame?.jobs[0] ?? {}).sort()).toEqual([
      'id',
      'kind',
      'label',
      'startedAt',
      'status',
    ])
  })

  it('fans an unowned change out to every attached session', async () => {
    const { ctx, control } = await harness(true)
    const second = ctx.sessions.create()
    const abort = new AbortController()
    const collected = collectJobs(control.control(abort.signal), 2, abort)

    ctx.jobs.start(producer('open to every caller').spec)

    const frames = await collected
    expect(new Set(frames.map(frame => frame.sessionId)).size).toBe(2)
    expect(frames.some(frame => frame.sessionId === second.id)).toBe(true)
    for (const frame of frames) expect(frame.jobs[0]?.label).toBe('open to every caller')
  })

  it('does not resume persisted sessions while projecting an unowned change', async () => {
    const { ctx, control } = await harness(true)
    const coldId = SessionId('session-cold-tasks')
    let loaded = false
    ctx.provide('sessionPersistence', {
      list: async () => [{ version: SESSION_FORMAT_VERSION, id: coldId, createdAt: 5, cwd: '/tmp' }],
      locate: () => undefined,
      load: () => { loaded = true; throw new Error('job projection must not load a cold log') },
    } as never)
    const abort = new AbortController()
    const collected = collectJobs(control.control(abort.signal), 1, abort)

    ctx.jobs.start(producer().spec)
    await collected
    expect(loaded).toBe(false)
    expect(ctx.agents.get(coldId)).toBeUndefined()
  })

  it('reports empty sets when no jobs registry is composed', async () => {
    const { session, control } = await harness(false)
    const frame = await baseline(control)
    expect(frame.value.jobs[session.id]).toEqual([])
  })

  it('never consumes model output while projecting a lifecycle', async () => {
    const { ctx, agent, control } = await harness(true)
    const abort = new AbortController()
    const collected = collectJobs(control.control(abort.signal), 3, abort)

    const task = producer()
    const id = ctx.jobs.start({ ...task.spec, owner: agent })
    ctx.jobs.kill(id, agent, 'test')
    task.settle({ status: 'killed', detail: 'signal: SIGTERM' })
    await collected

    expect(task.reads.count).toBe(0)
  })

  it('never consumes model output while producing a baseline', async () => {
    const { ctx, agent, control } = await harness(true)
    const task = producer()
    ctx.jobs.start({ ...task.spec, owner: agent })

    const frame = await baseline(control)

    expect(frame.value.jobs[agent.id]).toHaveLength(1)
    expect(task.reads.count).toBe(0)
  })

})

describe('Session control job output', () => {
  it('publishes live output lines with an advancing cursor and then goes quiet', async () => {
    const { ctx, agent, control } = await harness(true, { jobOutputPollMs: 10 })
    const task = outputProducer(['one'])
    const id = ctx.jobs.start({ ...task.spec, owner: agent })

    const abort = new AbortController()
    const frames = outputFrames(control.control(abort.signal), 2, abort)
    // The line the job produced before the stream attached still arrives: no
    // publishing runs while nothing is attached, so no cursor moved.
    for (let attempt = 0; attempt < 400 && task.lines.length < 2; attempt += 1) {
      if (attempt === 2) task.lines.push('two')
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    const seen = await frames
    expect(seen[0]).toMatchObject({ sessionId: agent.id, jobId: id, lines: ['one'], next: 1, truncated: false })
    expect(seen[1]).toMatchObject({ lines: ['two'], next: 2, truncated: false })
    expect(await strayFrame(control)).toBeUndefined()

    task.settle({ status: 'completed' })
    abort.abort()
  })

  it('bounds a burst across frames, loses no line, and reports a dropped-line gap', async () => {
    const { ctx, agent, control } = await harness(true, { jobOutputPollMs: 10 })
    const burst = Array.from({ length: 250 }, (_, index) => `line-${String(index)}`)
    const task = outputProducer(burst)
    const id = ctx.jobs.start({ ...task.spec, owner: agent })

    const abort = new AbortController()
    const frames = outputFrames(control.control(abort.signal), 3, abort)
    // Evict the tail of the burst before the next tick can read it, leaving a
    // retained window that starts past the cursor.
    setTimeout(() => { task.dropTo(['line-300', 'line-301'], 300) }, 40)

    const seen = await frames
    expect(seen[0]?.lines).toHaveLength(200)
    expect(seen[1]?.lines).toHaveLength(50)
    // Bounded frames still deliver the burst exactly once, in order.
    expect([...seen[0]!.lines, ...seen[1]!.lines]).toEqual(burst)
    expect(seen[0]!.next).toBe(200)
    expect(seen[1]!.next).toBe(250)
    expect(seen[2]).toMatchObject({ jobId: id, lines: ['line-300', 'line-301'], next: 302, truncated: true })

    task.settle({ status: 'completed' })
    abort.abort()
  })

  it('stays silent when a deployment disables output publishing', async () => {
    const { ctx, agent, control } = await harness(true, { jobOutputPollMs: 0 })
    const task = outputProducer(['never sent'])
    ctx.jobs.start({ ...task.spec, owner: agent })

    expect(await strayFrame(control)).toBeUndefined()

    task.settle({ status: 'completed' })
  })
})
