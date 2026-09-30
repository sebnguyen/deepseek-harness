import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionJob as JobView } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentListEntry } from '@deepseek-ai/dsh-subagent/client'
import {
  durationParts, isLive, jobRow, rowKey, sections, statusKey, subagentRows, type ActivityRow,
} from '../src/client/model.ts'

const SESSION = 'parent' as SessionId
const CHILD = 'child' as SessionId

function job(over: Partial<JobView> = {}): JobView {
  return {
    id: 'bash-1' as JobView['id'],
    kind: 'bash',
    label: 'pnpm run build',
    status: 'running',
    startedAt: 1_000,
    ...over,
  }
}

function summary(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: CHILD,
    displayTitle: 'child title',
    parentId: SESSION,
    origin: 'subagent',
    running: true,
    blank: false,
    updatedAt: 2_000,
    ...over,
  }
}

describe('isLive and statusKey', () => {
  it('treats running and stopping as live, everything else as settled', () => {
    expect(isLive('running')).toBe(true)
    expect(isLive('stopping')).toBe(true)
    expect(isLive('completed')).toBe(false)
    expect(isLive('killed')).toBe(false)
    expect(isLive('failed')).toBe(false)
    expect(isLive('inactive')).toBe(false)
  })

  it('maps every status to its locale key', () => {
    expect(statusKey('running')).toBe('status.running')
    expect(statusKey('stopping')).toBe('status.stopping')
    expect(statusKey('completed')).toBe('status.completed')
    expect(statusKey('killed')).toBe('status.killed')
    expect(statusKey('failed')).toBe('status.failed')
    expect(statusKey('inactive')).toBe('status.inactive')
  })
})

describe('durationParts', () => {
  it('splits into seconds below a minute', () => {
    expect(durationParts(45_000)).toEqual({ hours: 0, minutes: 0, seconds: 45 })
  })

  it('splits into minutes and seconds below an hour', () => {
    expect(durationParts(75_000)).toEqual({ hours: 0, minutes: 1, seconds: 15 })
  })

  it('stays in hours past an hour, and clamps negatives to zero', () => {
    expect(durationParts(3_700_000)).toEqual({ hours: 1, minutes: 1, seconds: 40 })
    expect(durationParts(-5)).toEqual({ hours: 0, minutes: 0, seconds: 0 })
  })
})

describe('subagentRows', () => {
  it('lists direct subagent children from summaries before any catalog read', () => {
    const rows = subagentRows(undefined, { [CHILD]: summary() }, SESSION)
    expect(rows).toEqual([{
      domain: 'subagent',
      id: CHILD,
      label: CHILD,
      side: 'subagent',
      status: 'running',
      live: true,
      startedAt: 2_000,
    }])
  })

  it('falls back through the durable title to the session id; ignores non-children', () => {
    const other = 'other' as SessionId
    const elsewhere = 'elsewhere' as SessionId
    const plain = 'plain' as SessionId
    const rows = subagentRows(undefined, {
      [CHILD]: summary(),
      [other]: summary({ id: other, parentId: elsewhere }),
      [plain]: { id: plain, displayTitle: 'plain', running: true, blank: false, updatedAt: 2_000 },
    }, SESSION)
    expect(rows.map(row => row.label)).toEqual([CHILD])

    const titled = subagentRows(undefined, { [CHILD]: summary({ title: 'research' }) }, SESSION)
    expect(titled[0]!.label).toBe('research')
  })

  it('prefers catalog labels and modes once the catalog is ready', () => {
    const entry: SubagentListEntry = {
      kind: 'child', id: CHILD, activity: 'running', hasChildren: false, mode: 'continuable', label: 'research',
    }
    const rows = subagentRows({ state: 'ready', entries: [entry] }, { [CHILD]: summary() }, SESSION)
    expect(rows[0]).toMatchObject({ label: 'research', side: 'continuable', status: 'running' })
  })

  it('keeps the summary row for children the catalog reports as diagnostics', () => {
    const entry: SubagentListEntry = { kind: 'diagnostic', id: CHILD, reason: 'corrupt' }
    const rows = subagentRows({ state: 'ready', entries: [entry] }, { [CHILD]: summary({ running: false }) }, SESSION)
    expect(rows[0]).toMatchObject({ label: CHILD, side: 'subagent', status: 'inactive', live: false })
  })

  it('reads nothing from an absent summary map', () => {
    expect(subagentRows(undefined, undefined, SESSION)).toEqual([])
  })
})

describe('sections', () => {
  const rows: ActivityRow[] = [
    jobRow(job({ id: 'bash-3' as JobView['id'], label: 'old done', status: 'completed', startedAt: 1, finishedAt: 2 })),
    jobRow(job({ id: 'bash-4' as JobView['id'], label: 'new done', status: 'failed', startedAt: 1, finishedAt: 9 })),
    jobRow(job({ id: 'bash-2' as JobView['id'], label: 'later live', startedAt: 5 })),
    jobRow(job({ id: 'bash-1' as JobView['id'], label: 'earlier live', startedAt: 3 })),
  ]

  it('orders live rows by start and archived rows newest-settled first', () => {
    const split = sections(rows)
    expect(split.live.map(row => row.label)).toEqual(['earlier live', 'later live'])
    expect(split.archive.map(row => row.label)).toEqual(['new done', 'old done'])
  })

  it('breaks same-millisecond settlements on start order', () => {
    const split = sections([
      jobRow(job({ id: 'a' as JobView['id'], status: 'completed', startedAt: 7, finishedAt: 9 })),
      jobRow(job({ id: 'b' as JobView['id'], status: 'killed', startedAt: 2, finishedAt: 9 })),
    ])
    expect(split.archive.map(row => row.id)).toEqual(['b', 'a'])
  })

  it('treats a settled row missing finishedAt as zero-length', () => {
    const childId = 'child' as SessionId
    const subagent = subagentRows(undefined, { [childId]: summary({ running: false }) }, SESSION)[0]!
    const split = sections([
      subagent,
      jobRow(job({ id: 'done' as JobView['id'], status: 'completed', startedAt: 2_000, finishedAt: 5_000 })),
    ])
    expect(split.archive.map(row => row.id)).toEqual(['done', 'child'])
  })
})

describe('rowKey', () => {
  it('keeps the two identity domains apart', () => {
    expect(rowKey(jobRow(job()))).toBe('job:bash-1')
    expect(rowKey(subagentRows(undefined, { [CHILD]: summary() }, SESSION)[0]!)).toBe('subagent:child')
  })
})
