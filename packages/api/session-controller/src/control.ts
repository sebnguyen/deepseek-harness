/** Live Session queue, jobs, and projection state with reconnect baselines. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, InboxState } from '@deepseek-ai/dsh-agent'
import { Deque } from '@deepseek-ai/dsh-deque'
import type { JobId, JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type {
  Session, SessionId, UserMessage,
} from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  SessionControlBaseline,
  SessionControlFrame,
  SessionJob,
  SessionProjectionBaseline,
  SessionProjectionValues,
  SessionQueuedItem,
} from './types.ts'

/** Lines one output frame carries before the next tick continues the job. */
const JOB_OUTPUT_FRAME_LINES = 200

/** Default interval between a job's output frames. */
const DEFAULT_JOB_OUTPUT_POLL_MS = 250

/** Owns the Host-wide Session control stream. */
export class SessionControlController {
  private readonly streams = new Set<ControlQueue>()
  /**
   * Highest absolute line index already published for each job. One cursor
   * serves every stream and advances only while a stream is attached, so
   * output published before a stream attached is not replayed to it: the
   * paged read is what serves earlier output.
   */
  private readonly outputCursors = new Map<JobId, number>()
  private outputTimer: ReturnType<typeof setInterval> | undefined

  /**
   * @param ctx - Host context carrying live Agent, projection, and jobs services.
   * @param options - output publishing policy; `jobOutputPollMs` is the interval between frames.
   */
  constructor(
    private readonly ctx: Context,
    private readonly options: { jobOutputPollMs: number } = { jobOutputPollMs: DEFAULT_JOB_OUTPUT_POLL_MS },
  ) {
    ctx.sessionProjections.onChanged((session, key, value, seq) => {
      this.broadcast({
        type: 'projection',
        sessionId: session.id,
        key,
        value: value as JsonValue,
        seq,
      })
      if (key !== 'inbox') return
      const agent = this.ctx.agents.get(session.id)
      if (agent?.session !== session) return
      this.broadcast({
        type: 'queue',
        sessionId: session.id,
        items: queueItemsFromInbox(value as InboxState),
      })
    })
    ctx.inject(['jobs'], (jobsCtx) => {
      jobsCtx.jobs.onJobsChanged((owner) => { this.onJobsChanged(owner) })
    })
    ctx.on('session/created', (session) => {
      const jobs = this.jobsFor(this.ctx.agents.get(session.id))
      if (jobs.length > 0) this.broadcast({ type: 'jobs', sessionId: session.id, jobs })
    })
    ctx.effect(() => () => {
      this.stopOutput()
      // Cursors outlive stream churn — a re-attached stream resumes rather
      // than replaying — and die only with the controller that owns them.
      this.outputCursors.clear()
      for (const stream of this.streams) stream.end()
      this.streams.clear()
    }, 'session-controller.control')
  }

  /**
   * Open one generation of Host-wide live control state.
   * @param signal - Remote stream cancellation.
   * @returns one complete baseline followed by live replacement frames.
   */
  async *control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    signal.throwIfAborted()
    const queue = new ControlQueue()
    this.streams.add(queue)
    this.startOutput()
    try {
      yield { type: 'baseline', value: this.baseline() }
      yield* queue.iterate(signal)
    } finally {
      this.streams.delete(queue)
      if (this.streams.size === 0) this.stopOutput()
      queue.end()
    }
  }

  private baseline(): SessionControlBaseline {
    const sessions = this.ctx.sessions.list()
    const queues = Object.create(null) as Record<SessionId, readonly SessionQueuedItem[]>
    const jobs = Object.create(null) as Record<SessionId, readonly SessionJob[]>
    for (const session of sessions) {
      const agent = this.ctx.agents.get(session.id)
      queues[session.id] = agent?.session === session ? queueItems(agent) : []
      jobs[session.id] = this.jobsFor(agent)
    }
    return {
      queues,
      jobs,
      projections: this.projectionBaseline(sessions),
    }
  }

  private projectionBaseline(
    sessions: readonly Session[],
  ): Readonly<Record<SessionId, SessionProjectionBaseline>> {
    const blocks = Object.create(null) as Record<SessionId, SessionProjectionBaseline>
    for (const session of sessions) {
      const snapshot = this.ctx.sessionProjections.snapshot(session)
      blocks[session.id] = {
        asOfSeq: snapshot.asOfSeq,
        // Every projection definition validates its value before snapshot publication.
        values: snapshot.values as SessionProjectionValues,
      }
    }
    return blocks
  }

  private onJobsChanged(owner: Agent | undefined): void {
    if (owner !== undefined) {
      this.broadcast({ type: 'jobs', sessionId: owner.id, jobs: this.jobsFor(owner) })
      return
    }
    for (const session of this.ctx.sessions.list()) {
      this.broadcast({
        type: 'jobs',
        sessionId: session.id,
        jobs: this.jobsFor(this.ctx.agents.get(session.id)),
      })
    }
  }

  private jobsFor(agent: Agent | undefined): SessionJob[] {
    const jobs = this.ctx.get('jobs')
    return jobs === undefined ? [] : jobs.list(agent).map(jobView)
  }

  private startOutput(): void {
    // A zero interval disables publishing rather than scheduling a busy loop.
    if (this.outputTimer !== undefined || this.options.jobOutputPollMs <= 0) return
    const timer = setInterval(() => { this.publishOutput() }, this.options.jobOutputPollMs)
    // Never let the publishing cadence hold a process open on its own.
    ;(timer as { unref?: () => void }).unref?.()
    this.outputTimer = timer
  }

  private stopOutput(): void {
    if (this.outputTimer === undefined) return
    clearInterval(this.outputTimer)
    this.outputTimer = undefined
  }

  /**
   * Send each job's lines that the streams have not seen yet. Publishing is
   * per job rather than per frame: a job keeps its cursor across ticks, so a
   * burst larger than one frame continues on the next tick instead of being
   * dropped, and a settled job flushes its tail before the cursor is pruned.
   */
  private publishOutput(): void {
    const jobs = this.ctx.get('jobs')
    if (jobs === undefined || this.streams.size === 0) return
    const seen = new Set<JobId>()
    for (const session of this.ctx.sessions.list()) {
      const agent = this.ctx.agents.get(session.id)
      if (agent?.session !== session) continue
      for (const snapshot of jobs.list(agent)) {
        seen.add(snapshot.id)
        const from = this.outputCursors.get(snapshot.id) ?? 0
        const page = jobs.readLines(snapshot.id, agent, from)
        if (page === undefined || page.lines.length === 0) continue
        // A truncated page starts after lines that were dropped, so the cursor
        // re-anchors on the first line the producer still retains.
        const first = page.truncated ? page.next - page.lines.length : from
        const lines = page.lines.slice(0, JOB_OUTPUT_FRAME_LINES)
        this.outputCursors.set(snapshot.id, first + lines.length)
        this.broadcast({
          type: 'jobOutput',
          sessionId: session.id,
          jobId: snapshot.id,
          lines,
          next: first + lines.length,
          truncated: page.truncated,
        })
      }
    }
    for (const id of this.outputCursors.keys()) {
      if (!seen.has(id)) this.outputCursors.delete(id)
    }
  }

  private broadcast(frame: SessionControlFrame): void {
    for (const stream of this.streams) stream.push(frame)
  }
}

class ControlQueue {
  private readonly buffer = new Deque<SessionControlFrame>()
  private wake: (() => void) | undefined
  private done = false

  push(frame: SessionControlFrame): void {
    if (this.done) return
    this.buffer.pushBack(frame)
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  end(): void {
    if (this.done) return
    this.done = true
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  async *iterate(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    const onAbort = (): void => { this.end() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!this.done && !signal.aborted) {
        const frame = this.buffer.popFront()
        if (frame !== undefined) {
          yield frame
          continue
        }
        await new Promise<void>((resolve) => { this.wake = resolve })
      }
      while (this.buffer.size > 0 && !signal.aborted) yield this.buffer.popFront() as SessionControlFrame
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.end()
    }
  }
}

function queueItems(agent: Agent): SessionQueuedItem[] {
  return queueItemsFromInbox({
    'next-turn': agent.inbox.nextTurn,
    'next-step': agent.inbox.nextStep,
  })
}

function queueItemsFromInbox(inbox: InboxState): SessionQueuedItem[] {
  return [
    ...inbox['next-turn'].map(message => ({
      id: message.id,
      placement: 'queued' as const,
      ...promptRpcId(message),
      message: { id: message.id, content: message.content as unknown as JsonValue[] },
    })),
    ...inbox['next-step'].map(message => ({
      id: message.id,
      placement: message.source.kind === 'user' ? 'steering' as const : 'context' as const,
      ...promptRpcId(message),
      message: { id: message.id, content: message.content as unknown as JsonValue[] },
    })),
  ]
}

/** Prompt-RPC identity carried by a browser-submitted message's user source. */
function promptRpcId(message: UserMessage): Pick<SessionQueuedItem, 'rpcId'> {
  const source = message.source
  return source.kind === 'user' && 'rpcId' in source ? { rpcId: source.rpcId } : {}
}

function jobView(job: JobSnapshot): SessionJob {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    ...(job.detail === undefined ? {} : { detail: job.detail }),
    startedAt: job.startedAt,
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
  }
}
