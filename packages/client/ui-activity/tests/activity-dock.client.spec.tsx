// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionJob as JobView } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ActivityDock, type ActivityDockProps } from '../src/client/ActivityDock.tsx'
import { zh } from '../src/client/locales.ts'

// Live rows render `now - startedAt`, so every assertion needs a pinned clock.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const SESSION = 'session' as SessionId
const CHILD = 'child' as SessionId
const START = 1_700_000_000_000
const t: ActivityDockProps['t'] = makeTranslate(zh)

function job(over: Partial<JobView> = {}): JobView {
  return {
    id: 'bash-1' as JobView['id'],
    kind: 'bash',
    label: 'pnpm run build',
    status: 'running',
    startedAt: START,
    ...over,
  }
}

interface Harness {
  state: SessionListState
  onRefresh: ReturnType<typeof vi.fn>
  onOpenChild: ReturnType<typeof vi.fn>
}

/**
 * List state for one session, optionally owning a direct one-shot child and
 * one job, with a ready catalog for the child.
 * @param jobs - the session's mirrored jobs, absent for none.
 * @param withChild - whether the session owns a direct subagent child.
 * @param childRunning - the child's durable running bit and catalog activity.
 */
function harness(
  jobs?: readonly JobView[],
  withChild = true,
  childRunning = true,
): Harness {
  const state = {
    ids: [SESSION],
    byId: withChild
      ? {
        [CHILD]: {
          id: CHILD, displayTitle: CHILD, origin: 'subagent', parentId: SESSION, running: childRunning, blank: false, updatedAt: START,
        },
      }
      : {},
    current: SESSION,
    phase: 'ready',
    subagentsByParent: withChild
      ? {
        [SESSION]: {
          state: 'ready',
          entries: [{ kind: 'child', id: CHILD, activity: childRunning ? 'running' as const : 'inactive' as const, hasChildren: false, mode: 'one-shot' as const, label: 'delegate build' }],
          error: null,
        },
      }
      : {},
    jobsBySession: jobs === undefined ? {} : { [SESSION]: jobs },
    jobOutputBySession: {},
    currentAddress: undefined,
  } satisfies SessionListState
  return {
    state,
    onRefresh: vi.fn(),
    onOpenChild: vi.fn(),
  }
}

function props(h: Harness): ActivityDockProps {
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(h.state)
  }
  return {
    sessionId: SESSION,
    useSessions,
    t,
    onRefresh: h.onRefresh,
    onOpenChild: h.onOpenChild,
  } as unknown as ActivityDockProps
}

/** Open the drawer through the chip. */
function openDock(): void {
  fireEvent.click(screen.getByRole('button', { name: /后台活动/ }))
}

describe('ActivityDock chip', () => {
  it('renders nothing while the session owns no background item', () => {
    const { container } = render(<ActivityDock {...props(harness(undefined, false))} />)
    expect(container.innerHTML).toBe('')
  })

  it('keeps no chip on an addressed child route: its activity rides the owner drawer', () => {
    const h = harness([job()])
    h.state = {
      ...h.state,
      currentAddress: { parentSessionId: SESSION, childSessionId: CHILD, mode: 'one-shot' } as SessionListState['currentAddress'],
    }
    const targeted = {
      ...props(h),
      sessionId: CHILD,
      useSessions: <T,>(select: (snapshot: SessionListState) => T): T => select(h.state),
    } as unknown as ActivityDockProps
    const { container } = render(<ActivityDock {...targeted} />)
    expect(container.innerHTML).toBe('')
  })

  it('counts jobs plus subagents, live rows first', () => {
    render(<ActivityDock {...props(harness([job()]))} />)
    expect(screen.getByRole('button', { name: '2 个后台活动运行中' })).toBeDefined()
  })

  it('falls back to the archived total when nothing is live', () => {
    render(<ActivityDock {...props(harness([job({ status: 'failed', finishedAt: START + 1 })], true, false))} />)
    expect(screen.getByRole('button', { name: '2 个后台活动' })).toBeDefined()
  })

  it('uses the singular copy for exactly one row of either kind', () => {
    let h = harness([job()], false)
    const view = render(<ActivityDock {...props(h)} />)
    expect(screen.getByRole('button', { name: '1 个后台活动运行中' })).toBeDefined()
    const state = { ...h.state, jobsBySession: { [SESSION]: [job({ status: 'completed', finishedAt: START + 1 })] } }
    h = { ...h, state }
    view.rerender(<ActivityDock {...props(h)} />)
    expect(screen.getByRole('button', { name: '1 个后台活动' })).toBeDefined()
  })

  it('closes and unmounts when the last row disappears while open', () => {
    const h = harness([job()])
    const view = render(<ActivityDock {...props(h)} />)
    openDock()
    expect(screen.getByRole('region', { name: zh['drawer.aria'] })).toBeDefined()
    h.state = { ...h.state, jobsBySession: {}, byId: {}, subagentsByParent: {} }
    view.rerender(<ActivityDock {...props(h)} />)
    expect(view.container.innerHTML).toBe('')
  })
})

describe('ActivityDock tree and detail', () => {
  it('lists the live job and the subagent, then settles into the archive', () => {
    const h = harness([job()])
    const view = render(<ActivityDock {...props(h)} />)
    openDock()
    expect(h.onRefresh).toHaveBeenCalled()

    const live = within(screen.getByRole('list', { name: zh['tree.live.aria'] }))
    expect(live.getAllByRole('listitem')).toHaveLength(2)

    // The registry settles the job and the child goes inactive: the archive
    // header carries the count and stays collapsed until opened.
    act(() => { vi.advanceTimersByTime(4_000) })
    h.state = {
      ...h.state,
      jobsBySession: { [SESSION]: [job({ status: 'failed', detail: 'exit 1', finishedAt: START + 4_000 })] },
      subagentsByParent: {
        [SESSION]: {
          state: 'ready',
          entries: [{ kind: 'child', id: CHILD, activity: 'inactive' as const, hasChildren: false, mode: 'one-shot' as const, label: 'delegate build' }],
          error: null,
        },
      },
      byId: { ...h.state.byId, [CHILD]: { ...h.state.byId[CHILD]!, running: false } },
    }
    view.rerender(<ActivityDock {...props(h)} />)
    expect(screen.getByRole('button', { name: '已归档（2）' })).toBeDefined()

    // The archive stays collapsed until its header opens it.
    expect(screen.queryByRole('list', { name: zh['tree.archive.aria'] })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '已归档（2）' }))
    const archive = within(screen.getByRole('list', { name: zh['tree.archive.aria'] }))
    expect(archive.getAllByRole('listitem')).toHaveLength(2)
  })

  it('selecting a failed job row surfaces the producer detail in the pane', () => {
    render(<ActivityDock {...props(harness([job({ status: 'failed', detail: 'exit 1' })]))} />)
    openDock()
    fireEvent.click(screen.getByRole('button', { name: '已归档（1）' }))
    fireEvent.click(screen.getByTestId('activity-row-job:bash-1'))
    const detail = within(screen.getByLabelText(zh['detail.aria']))
    expect(detail.getByText('exit 1')).toBeDefined()
  })

  it('streams the selected job output buffer and tails new lines', () => {
    const h = harness([job()])
    h.state = {
      ...h.state,
      jobOutputBySession: { [SESSION]: { [job().id]: { lines: ['line one'], first: 0, next: 1 } } },
    }
    const view = render(<ActivityDock {...props(h)} />)
    openDock()
    fireEvent.click(screen.getByTestId('activity-row-job:bash-1'))
    const detail = within(screen.getByLabelText(zh['detail.aria']))
    const tail = detail.getByLabelText(zh['output.aria'])
    expect(tail.textContent).toBe('line one')

    // A later frame appends: the pane follows and keeps the tail in view.
    h.state = {
      ...h.state,
      jobOutputBySession: { [SESSION]: { [job().id]: { lines: ['line one', 'line two'], first: 0, next: 2 } } },
    }
    view.rerender(<ActivityDock {...props(h)} />)
    expect(detail.getByLabelText(zh['output.aria']).textContent).toBe('line one\nline two')
  })

  it('shows the empty output copy until a job produces lines', () => {
    render(<ActivityDock {...props(harness([job()]))} />)
    openDock()
    fireEvent.click(screen.getByTestId('activity-row-job:bash-1'))
    const detail = within(screen.getByLabelText(zh['detail.aria']))
    expect(detail.getByText(zh['output.empty'])).toBeDefined()
  })

  it('falls back to the status word for a selected job without detail', () => {
    render(<ActivityDock {...props(harness([job({ status: 'stopping' })]))} />)
    openDock()
    fireEvent.click(screen.getByTestId('activity-row-job:bash-1'))
    const detail = within(screen.getByLabelText(zh['detail.aria']))
    expect(detail.getByText(zh['status.stopping'])).toBeDefined()
  })

  it('routes a selected subagent through its catalog address', () => {
    const h = harness()
    render(<ActivityDock {...props(h)} />)
    openDock()
    fireEvent.click(screen.getByTestId('activity-row-subagent:child'))
    fireEvent.click(screen.getByRole('button', { name: zh['open.session'] }))
    expect(h.onOpenChild).toHaveBeenCalledWith(CHILD)
  })

  it('disables open-as-session while the catalog is not ready', () => {
    const h = harness()
    h.state = { ...h.state, subagentsByParent: { [SESSION]: { state: 'loading', entries: [], error: null } } }
    render(<ActivityDock {...props(h)} />)
    openDock()
    fireEvent.click(screen.getByTestId('activity-row-subagent:child'))
    expect(screen.getByRole('button', { name: zh['open.session'] }).hasAttribute('disabled')).toBe(true)
  })

  it('hides the archive behind the alive-only filter', () => {
    render(<ActivityDock {...props(harness([job({ status: 'completed', finishedAt: START + 1 })], true, false))} />)
    openDock()
    fireEvent.click(screen.getByRole('button', { name: zh['filter.alive'] }))
    expect(screen.queryByRole('button', { name: '已归档（2）' })).toBeNull()
  })

  it('walks rows with the arrow keys and closes on escape', () => {
    const h = harness([job()])
    render(<ActivityDock {...props(h)} />)
    openDock()
    const first = screen.getByTestId('activity-row-job:bash-1')
    act(() => { first.focus() })
    fireEvent.keyDown(screen.getByRole('region', { name: zh['drawer.aria'] }), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByTestId('activity-row-subagent:child'))

    fireEvent.keyDown(screen.getByRole('region', { name: zh['drawer.aria'] }), { key: 'Escape' })
    // The drawer collapses in place: its region leaves the accessibility
    // tree and the tab order while the chip regains focus.
    expect(screen.queryByRole('region', { name: zh['drawer.aria'] })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /后台活动/ }))
  })

  it('ticks live durations once a second while open', () => {
    render(<ActivityDock {...props(harness([job()]))} />)
    openDock()
    const duration = (): string => within(screen.getByRole('list', { name: zh['tree.live.aria'] }))
      .getAllByRole('listitem')[0]!.textContent ?? ''
    const before = duration()
    act(() => { vi.advanceTimersByTime(65_000) })
    expect(duration()).not.toBe(before)
    expect(screen.getAllByText('1分5秒').length).toBeGreaterThan(0)
  })

  it('renders the hour unit for runs past an hour', () => {
    render(<ActivityDock {...props(harness([job()]))} />)
    openDock()
    act(() => { vi.advanceTimersByTime(2 * 3_600_000 + 60_000) })
    expect(screen.getAllByText('2小时1分').length).toBeGreaterThan(0)
  })

  it('marks stopping, completed, and killed rows with their status words', () => {
    render(<ActivityDock {...props(harness([
      job({ id: 'bash-2' as JobView['id'], label: 'stopping one', status: 'stopping' }),
      job({ id: 'bash-3' as JobView['id'], label: 'done one', status: 'completed', finishedAt: START + 2_000 }),
      job({ id: 'bash-4' as JobView['id'], label: 'killed one', status: 'killed', finishedAt: START + 3_000 }),
    ]))} />)
    openDock()
    fireEvent.click(screen.getByRole('button', { name: '已归档（2）' }))
    const texts = screen.getByRole('region', { name: zh['drawer.aria'] }).textContent ?? ''
    expect(texts).toContain(zh['status.stopping'])
    expect(texts).toContain(zh['status.completed'])
    expect(texts).toContain(zh['status.killed'])
  })

  it('ignores keys that are neither arrows nor escape', () => {
    render(<ActivityDock {...props(harness([job()]))} />)
    openDock()
    fireEvent.keyDown(screen.getByRole('region', { name: zh['drawer.aria'] }), { key: 'a' })
    expect(screen.getByRole('region', { name: zh['drawer.aria'] })).toBeDefined()
  })
})
