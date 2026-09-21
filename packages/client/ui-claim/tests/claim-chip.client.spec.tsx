// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { Claim } from '@deepseek-ai/dsh-claim/client'
import { ClaimDock, type ClaimDockProps } from '../src/client/ClaimChip.tsx'
import { zh } from '../src/client/locales.ts'

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

function dockProps(claims: readonly Claim[] | undefined, running = true): ClaimDockProps {
  return {
    useSession: (selector: (snapshot: { running: boolean }) => unknown) => selector({ running }),
    useProjection: projectionOf(claims),
    t: makeTranslate(zh, commonZh),
  } as unknown as ClaimDockProps
}

describe('claim chip', () => {
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

  it('blocked claim shows the failure reason in its details card', () => {
    render(<ClaimDock {...dockProps([makeClaim({
      settlement: { kind: 'blocked', code: 'abandoned', message: 'wrong condition' },
    })])} />)
    fireEvent.click(screen.getByRole('button', { name: '声明' }))
    fireEvent.click(screen.getByText('Land the export fix'))
    expect(screen.getByText(/未通过原因: wrong condition/)).toBeTruthy()
  })

  it('status lines report the last verifier run', () => {
    render(<ClaimDock {...dockProps([makeClaim({
      results: [{ outcome: 'fail', evidence: 'exit 1' }],
      settlement: { kind: 'blocked', code: 'repair-budget-exhausted', message: 'budget' },
    })])} />)
    fireEvent.click(screen.getByRole('button', { name: '声明' }))
    fireEvent.click(screen.getByText('Land the export fix'))
    expect(screen.getByText(/最近核验: 失败/)).toBeTruthy()
  })
})
