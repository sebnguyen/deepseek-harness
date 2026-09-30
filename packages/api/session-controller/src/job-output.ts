/**
 * Paged read of one job's retained output for the browser. The pushed
 * `jobOutput` frames carry what was produced while a stream was attached; this
 * serves what a view needs when it opens late or scrolls back.
 */

import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionJobOutputRequest, SessionJobOutputValue } from './types.ts'

/** Lines one page carries; a consumer continues from `next`. */
export const JOB_OUTPUT_PAGE_LINES = 500

/**
 * Read a job's retained output lines without consuming the model's stream.
 * @param ctx - Host context carrying the jobs service and live Agents.
 * @param request - owning Session, job id, and absolute line index to read from.
 * @returns the retained lines from that index, where to continue, and whether the producer keeps an addressable buffer.
 * @throws RemoteError when the request is malformed, the Session has no live Agent, or the job is unknown or foreign.
 */
export function readJobOutput(ctx: Context, request: SessionJobOutputRequest): SessionJobOutputValue {
  const from = request.from ?? 0
  if (!Number.isSafeInteger(from) || from < 0) {
    throw new RemoteError('gateway/bad-request', `"from" must be a non-negative line index, received ${String(from)}`, {})
  }
  // A job is readable only through its owning live Agent: jobs are keyed by
  // owner, so a cold Session has no jobs to page through.
  const agent = ctx.agents.get(request.sessionId)
  if (agent === undefined) {
    throw new RemoteError(
      'session/not-found',
      `session "${request.sessionId}" has no live agent`,
      { sessionId: request.sessionId },
    )
  }
  const jobs = ctx.get('jobs')
  if (jobs === undefined) {
    throw new RemoteError(
      'session/job-not-found',
      `job "${request.jobId}" is not readable because this deployment mounts no job registry`,
      { sessionId: request.sessionId, jobId: request.jobId },
    )
  }
  let page
  try {
    page = jobs.readLines(request.jobId, agent, from)
  } catch (error: unknown) {
    // A plain throw from the registry means unknown or foreign, and both are
    // the same answer to a caller that may not read this job.
    throw new RemoteError(
      'session/job-not-found',
      error instanceof Error ? error.message : String(error),
      { sessionId: request.sessionId, jobId: request.jobId },
      { cause: error },
    )
  }
  if (page === undefined) {
    return { lines: [], next: from, truncated: false, addressable: false }
  }
  // A producer that dropped lines reports it and returns what it still retains,
  // so the page re-anchors on the oldest retained line the same way a frame does.
  const first = page.truncated ? page.next - page.lines.length : from
  const lines = page.lines.slice(0, JOB_OUTPUT_PAGE_LINES)
  return { lines, next: first + lines.length, truncated: page.truncated, addressable: true }
}
