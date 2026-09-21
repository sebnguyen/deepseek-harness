// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { Claim } from '@deepseek-ai/dsh-claim/client'
import {
  ClaimAction, ClaimChip, ClaimDock, type ClaimActionProps, type ClaimDockProps,
} from '../src/client/ClaimChip.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh) as Parameters<typeof ClaimChip>[0]['t']

afterEach(cleanup)

function makeClaim(over: Partial<Claim> = {}): Claim {
  return {
    id: 'c1' as Claim['id'],
    turn: 3,
    revision: 1,
    title: 'Land the export fix',
    description: 'The verifier exits 0',
    verifier: { source: 'exit 0', digest: 'a'.repeat(64) },
    results: [],
    settlement: { kind: 'pending' },
    ...over,
  }
}

/** A useProjection stub over one claim ledger, honoring the selector overload. */
function projectionOf(claims: readonly Claim[] | undefined) {
  return (_key: string, selector?: (value: readonly Claim[] | undefined) => unknown) =>
    selector === undefined ? claims : selector(claims)
}

function actionProps(claims: readonly Claim[] | undefined, turn = 3): ClaimActionProps {
  return {
    messageId: 'm1',
    turn: {
      turn,
      start: undefined,
      end: undefined,
      status: 'open',
      steps: [],
      data: {
        get: () => undefined,
        source: (() => ({ getSnapshot: () => undefined, subscribe: () => () => {} })) as never,
      },
    },
    useProjection: projectionOf(claims),
    t,
  } as unknown as ClaimActionProps
}

function dockProps(claims: readonly Claim[] | undefined, running = true): ClaimDockProps {
  return {
    useSession: (selector: (snapshot: { running: boolean }) => unknown) => selector({ running }),
    useProjection: projectionOf(claims),
    t,
  } as unknown as ClaimDockProps
}

describe('claim chip', () => {
  it('renders nothing for a turn without a claim or without the claim projection', () => {
    const absent = render(<ClaimAction {...actionProps(undefined)} />)
    expect(absent.container.firstChild).toBeNull()
    cleanup()

    const noClaim = render(<ClaimAction {...actionProps([])} />)
    expect(noClaim.container.firstChild).toBeNull()
  })

  it('renders nothing on a turn with no claims of its own, even when another turn is pending', () => {
    const later = render(<ClaimAction {...actionProps([makeClaim({ turn: 3 })], 4)} />)
    expect(later.container.firstChild).toBeNull()
  })

  it('dock renders nothing while the ledger is absent or empty', () => {
    const absent = render(<ClaimDock {...dockProps(undefined)} />)
    expect(absent.container.firstChild).toBeNull()
    cleanup()

    const empty = render(<ClaimDock {...dockProps([])} />)
    expect(empty.container.firstChild).toBeNull()
  })

  it('dock trigger carries the aggregate dot and opens a menu of the latest turn\'s claims', () => {
    render(<ClaimDock {...dockProps([
      makeClaim({ id: 'a' as Claim['id'], title: 'alpha' }),
      makeClaim({ id: 'b' as Claim['id'], title: 'beta', settlement: { kind: 'passed' } }),
      makeClaim({ id: 'c' as Claim['id'], title: 'gamma', settlement: { kind: 'blocked', code: 'abandoned', message: 'wrong' } }),
    ])} />)
    const trigger = screen.getByRole('button', { name: '声明' })
    // Any failure drives the aggregate dot red.
    expect(trigger.querySelector('[data-state="error"]')).toBeTruthy()
    expect(screen.queryByText('alpha')).toBeNull()
    fireEvent.click(trigger)
    expect(screen.getByText('alpha').closest('[data-state]')?.getAttribute('data-state')).toBe('pending')
    expect(screen.getByText('beta').closest('[data-state]')?.getAttribute('data-state')).toBe('passed')
    expect(screen.getByText('gamma').closest('[data-state]')?.getAttribute('data-state')).toBe('blocked')
    expect(screen.getByText('声明已通过')).toBeTruthy()
    expect(screen.getByText('声明未通过')).toBeTruthy()
    // Clicking the trigger again closes the menu.
    fireEvent.click(trigger)
    expect(screen.queryByText('alpha')).toBeNull()
  })

  it('dock menu lists only the claims of the latest turn, and a blue dot while pending', () => {
    render(<ClaimDock {...dockProps([
      makeClaim({ id: 'a' as Claim['id'], turn: 3, title: 'alpha' }),
      makeClaim({ id: 'b' as Claim['id'], turn: 4, title: 'beta' }),
    ])} />)
    const trigger = screen.getByRole('button', { name: '声明' })
    // All pending -> blue (ongoing) aggregate dot.
    expect(trigger.querySelector('[data-state="ongoing"]')).toBeTruthy()
    fireEvent.click(trigger)
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.getByText('beta')).toBeTruthy()
  })

  it('dock trigger turns green once every latest-turn claim passed', () => {
    render(<ClaimDock {...dockProps([
      makeClaim({ id: 'a' as Claim['id'], title: 'alpha', settlement: { kind: 'passed' } }),
      makeClaim({ id: 'b' as Claim['id'], title: 'beta', settlement: { kind: 'passed' } }),
    ])} />)
    const trigger = screen.getByRole('button', { name: '声明' })
    expect(trigger.querySelector('[data-state="done"]')).toBeTruthy()
  })

  it('dock menu row expands the claim details on click', () => {
    render(<ClaimDock {...dockProps([makeClaim()])} />)
    fireEvent.click(screen.getByRole('button', { name: '声明' }))
    fireEvent.click(screen.getByText('Land the export fix'))
    expect(screen.getByText('The verifier exits 0')).toBeTruthy()
    expect(screen.getByText('exit 0')).toBeTruthy()
  })

  it('action row renders one accordion list, collapsed until a row is clicked', () => {
    const claims = [
      makeClaim({ id: 'c0' as Claim['id'], title: 'alpha', settlement: { kind: 'passed' } }),
      makeClaim({ id: 'c1' as Claim['id'], title: 'beta' }),
    ]
    render(<ClaimAction {...actionProps(claims, 3)} />)
    // Both claims are listed collapsed; no details prose is visible yet.
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('beta')).toBeTruthy()
    expect(screen.queryByText('The verifier exits 0')).toBeNull()
    // Expanding one row reveals the shared details card.
    fireEvent.click(screen.getByText('alpha'))
    expect(screen.getByText('The verifier exits 0')).toBeTruthy()
    // The settled claim keeps its status label on the row.
    expect(screen.getByText('声明已通过')).toBeTruthy()
  })

  it('action row lists only the owning turn, ignoring other turns', () => {
    const claims = [
      makeClaim({ id: 'c0' as Claim['id'], turn: 3, title: 'alpha' }),
      makeClaim({ id: 'c1' as Claim['id'], turn: 4, title: 'beta' }),
    ]
    render(<ClaimAction {...actionProps(claims, 3)} />)
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.queryByText('beta')).toBeNull()
  })

  it('chip starts collapsed and toggles a details card with all three accordions', () => {
    render(<ClaimChip claim={makeClaim()} t={t} />)
    expect(screen.queryByText('标题')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '核验声明中' }))
    expect(screen.getByText('标题')).toBeTruthy()
    expect(screen.getByText('描述')).toBeTruthy()
    expect(screen.getByText('The verifier exits 0')).toBeTruthy()
    expect(screen.getByText('exit 0')).toBeTruthy()
    // The title appears on both the chip label and the details prose.
    expect(screen.getAllByText('Land the export fix').length).toBeGreaterThanOrEqual(2)
    // A section header collapses only that section.
    fireEvent.click(screen.getByRole('button', { name: '描述' }))
    expect(screen.queryByText('The verifier exits 0')).toBeNull()
  })

  it('carries the settlement kind as the chip data-state and accessible label', () => {
    render(<ClaimChip claim={makeClaim({ settlement: { kind: 'passed' } })} t={t} />)
    const button = screen.getByRole('button', { name: '声明已通过' })
    expect(button.getAttribute('data-state')).toBe('passed')
  })

  it('blocked claim shows the failure reason in its details card', () => {
    render(<ClaimChip claim={makeClaim({
      settlement: { kind: 'blocked', code: 'abandoned', message: 'wrong condition' },
    })} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '声明未通过' }))
    expect(screen.getByText(/未通过原因: wrong condition/)).toBeTruthy()
  })

  it('status lines report the last verifier run', () => {
    render(<ClaimChip claim={makeClaim({
      results: [{ outcome: 'fail', evidence: 'exit 1' }],
      settlement: { kind: 'blocked', code: 'repair-budget-exhausted', message: 'budget' },
    })} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: '声明未通过' }))
    expect(screen.getByText(/最近核验: 失败/)).toBeTruthy()
  })
})
