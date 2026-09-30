/**
 * Pure projection of the Session Controller mirrors into the drawer's row model.
 * No React, no subscription machinery: the component feeds mirror slices in
 * and draws the rows it gets back.
 */

import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionJob as JobView } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent/client'

/** Which source of truth one row came from. */
export type ActivityDomain = 'job' | 'subagent'

/** One row status: the five wire job statuses, plus `inactive` for a settled subagent. */
export type ActivityStatus = JobView['status'] | 'inactive'

/** One drawer row, JSON-compatible and domain-uniform. */
export interface ActivityRow {
  readonly domain: ActivityDomain
  readonly id: string
  readonly label: string
  /** Verbatim side text: the producer kind for a job, the descriptor mode for a subagent. */
  readonly side: string
  readonly status: ActivityStatus
  readonly live: boolean
  readonly startedAt: number
  readonly finishedAt?: number
  /** The producer's raw detail, legible where a status word alone would hide a failure. */
  readonly detail?: string
}

/** A job the registry still holds open, and whose duration therefore ticks. */
export function isLive(status: ActivityStatus): boolean {
  return status === 'running' || status === 'stopping'
}

/** Locale key for the human status word of a row. */
export function statusKey(status: ActivityStatus): `status.${ActivityStatus}` {
  switch (status) {
    case 'running': return 'status.running'
    case 'stopping': return 'status.stopping'
    case 'completed': return 'status.completed'
    case 'killed': return 'status.killed'
    case 'failed': return 'status.failed'
    case 'inactive': return 'status.inactive'
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/* v8 ignore next 3 -- closed-union backstop; only reached if a status is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled activity status: ${JSON.stringify(value)}`)
}

/** One job mirror record as a drawer row. */
export function jobRow(job: JobView): ActivityRow {
  if (job.finishedAt === undefined) {
    return job.detail === undefined
      ? { domain: 'job', id: job.id, label: job.label, side: job.kind, status: job.status, live: isLive(job.status), startedAt: job.startedAt }
      : { domain: 'job', id: job.id, label: job.label, side: job.kind, status: job.status, live: isLive(job.status), startedAt: job.startedAt, detail: job.detail }
  }
  return job.detail === undefined
    ? { domain: 'job', id: job.id, label: job.label, side: job.kind, status: job.status, live: isLive(job.status), startedAt: job.startedAt, finishedAt: job.finishedAt }
    : { domain: 'job', id: job.id, label: job.label, side: job.kind, status: job.status, live: isLive(job.status), startedAt: job.startedAt, detail: job.detail, finishedAt: job.finishedAt }
}

/**
 * Elapsed time split into at most two adjacent units. A background item that
 * outlives an hour is already exceptional, so hours is the widest unit.
 * @param elapsedMs - milliseconds between the row's start and the sample clock.
 * @returns whole hours, the minutes remainder, and the seconds remainder.
 */
export function durationParts(elapsedMs: number): { hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  return {
    hours: Math.floor(total / 3_600),
    minutes: Math.floor(total / 60) % 60,
    seconds: total % 60,
  }
}

/**
 * The direct subagent children of one session as drawer rows. The parent's
 * catalog, once ready, is authoritative for label and descriptor mode; before
 * the first catalog read the session summaries carry the row with its
 * durable running bit, so a one-shot child appears the moment its parent's
 * list mirror shows it.
 * @param catalog - the parent-addressed catalog snapshot, absent before first read.
 * @param summaries - session list summaries keyed by id.
 * @param sessionId - the session whose direct children are listed.
 * @returns one row per direct subagent child, in catalog order then summary order.
 */
export function subagentRows(
  catalog: { state: string; entries?: readonly SubagentListEntry[] } | undefined,
  summaries: Readonly<Record<SessionId, SessionSummary>> | undefined,
  sessionId: SessionId,
): ActivityRow[] {
  const children = Object.values(summaries ?? {})
    .filter(summary => summary.parentId === sessionId && summary.origin === 'subagent')
  const rows: ActivityRow[] = []
  for (const child of children) {
    const entry = catalog?.state === 'ready'
      ? catalog.entries?.find(candidate => candidate.kind === 'child' && candidate.id === child.id)
      : undefined
    const healthy = entry !== undefined && entry.kind === 'child' ? entry : undefined
    const status: ActivityStatus = (healthy?.activity ?? (child.running ? 'running' : 'inactive')) === 'running'
      ? 'running'
      : 'inactive'
    rows.push({
      domain: 'subagent',
      id: child.id,
      label: healthy?.label ?? child.title ?? child.id,
      side: healthy === undefined ? 'subagent' : healthy.mode,
      status,
      live: isLive(status),
      startedAt: child.updatedAt,
    })
  }
  return rows
}

/**
 * Live rows first in start order, then settled rows newest-first. Two rows
 * that settled in the same millisecond fall back to start order, so the
 * sort never depends on a host map iteration.
 * @param rows - the rows of one session, in any arrival order.
 * @returns the live section and the archive section of the drawer.
 */
export function sections(rows: readonly ActivityRow[]): { live: ActivityRow[]; archive: ActivityRow[] } {
  const live = rows.filter(row => row.live).sort((a, b) => a.startedAt - b.startedAt)
  const archive = rows.filter(row => !row.live).sort((a, b) => {
    const finished = (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt)
    return finished !== 0 ? finished : a.startedAt - b.startedAt
  })
  return { live, archive }
}

/** The selection key of a row, unique across the two identity domains. */
export function rowKey(row: ActivityRow): string {
  return `${row.domain}:${row.id}`
}
