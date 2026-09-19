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
    purpose: 'Land the export fix',
    satisfy: 'The verifier exits 0',
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

  it('dock renders nothing while no claim is pending, and while the ledger is absent', () => {
    const absent = render(<ClaimDock {...dockProps(undefined)} />)
    expect(absent.container.firstChild).toBeNull()
    cleanup()

    const settled = render(<ClaimDock {...dockProps([makeClaim({ settlement: { kind: 'passed' } })])} />)
    expect(settled.container.firstChild).toBeNull()
  })

  it('dock hides a pending claim once the session stops running, and shows it while running', () => {
    const stopped = render(<ClaimDock {...dockProps([makeClaim()], false)} />)
    expect(stopped.container.firstChild).toBeNull()
    cleanup()

    render(<ClaimDock {...dockProps([makeClaim()], true)} />)
    expect(screen.getByText('核验声明中')).toBeTruthy()
  })

  it('pending claim: dock strip with the card already expanded, no click needed', () => {
    render(<ClaimDock {...dockProps([makeClaim()])} />)
    expect(screen.getByText('核验声明中')).toBeTruthy()
    // The three accordions are visible immediately, without any click.
    expect(screen.getByRole('button', { name: '目的' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '完成条件' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '核验脚本' })).toBeTruthy()
    // The purpose appears in the strip header and its open accordion body.
    expect(screen.getAllByText('Land the export fix').length).toBeGreaterThanOrEqual(1)
    expect(document.querySelector('[data-claim-dock="pending"]')).toBeTruthy()
  })

  it('action-row chip starts closed and toggles a details card with all accordions open', () => {
    render(<ClaimChip claim={makeClaim()} t={t} />)
    expect(screen.queryByText('目的')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '核验声明中' }))
    // One click shows the card; every accordion is already expanded.
    expect(screen.getByText('Land the export fix')).toBeTruthy()
    expect(screen.getByText('The verifier exits 0')).toBeTruthy()
    expect(screen.getByText('exit 0')).toBeTruthy()
    // A section header collapses only that section.
    fireEvent.click(screen.getByRole('button', { name: '目的' }))
    expect(screen.queryByText('Land the export fix')).toBeNull()
  })

  it('pending claim in the action row: status chip with the ongoing label', () => {
    render(<ClaimAction {...actionProps([makeClaim()])} />)
    expect(screen.getByText('核验声明中')).toBeTruthy()
  })

  it('passed claim: passed label in the action row', () => {
    render(<ClaimAction {...actionProps([makeClaim({ settlement: { kind: 'passed' } })])} />)
    expect(screen.getByText('声明已通过')).toBeTruthy()
  })

  it('blocked claim: blocked label, and the details card shows the three accordions', () => {
    render(<ClaimChip claim={makeClaim({
      settlement: { kind: 'blocked', code: 'abandoned', message: 'wrong condition' },
    })} t={t} />)
    const chip = screen.getByText('声明未通过')
    fireEvent.click(chip)
    // The three accordions, all expanded by default.
    expect(screen.getByRole('button', { name: '目的' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '完成条件' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '核验脚本' })).toBeTruthy()
    expect(screen.getByText('Land the export fix')).toBeTruthy()
    // The failed-settlement reason is a status line, not hidden in an accordion.
    expect(screen.getByText(/未通过原因: wrong condition/)).toBeTruthy()
  })

  it('script accordion is open by default and collapses on its header click', () => {
    render(<ClaimChip claim={makeClaim()} t={t} />)
    fireEvent.click(screen.getByText('核验声明中'))
    // Open by default: the raw verifier source is visible without clicking.
    expect(screen.getByText('exit 0')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '核验脚本' }))
    expect(screen.queryByText('exit 0')).toBeNull()
  })

  it('status lines report the last verifier run', () => {
    render(<ClaimChip claim={makeClaim({
      results: [{ outcome: 'fail', evidence: 'exit 1' }],
      settlement: { kind: 'blocked', code: 'repair-budget-exhausted', message: 'budget' },
    })} t={t} />)
    fireEvent.click(screen.getByText('声明未通过'))
    expect(screen.getByText(/最近核验: 失败/)).toBeTruthy()
  })

  it('picks the owning turn out of the ledger and ignores other turns', () => {
    const claims = [
      makeClaim({ id: 'c0' as Claim['id'], turn: 2, settlement: { kind: 'passed' } }),
      makeClaim({ id: 'c1' as Claim['id'], turn: 3 }),
    ]
    render(<ClaimAction {...actionProps(claims, 3)} />)
    expect(screen.getByText('核验声明中')).toBeTruthy()
  })
})
