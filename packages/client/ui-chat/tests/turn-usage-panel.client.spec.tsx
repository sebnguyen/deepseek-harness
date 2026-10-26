// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { TurnTimePanel, TurnUsagePanel } from '../src/client/chat/TurnUsagePanel.tsx'
import type { TurnTokenUsage } from '../src/client/contract/chat-nodes.ts'
import { en } from '../src/client/locale.ts'

const t = makeTranslate(en, commonEn)

afterEach(cleanup)

describe('TurnUsagePanel', () => {
  it('shows an icon-and-total pill and opens the usage dialog on click', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 5_060,
      cacheReadTokens: 4_940,
      cacheWriteTokens: 0,
      outputTokens: 5_800,
      reasoningTokens: 42,
      totalTokens: 15_800,
      routes: [{ provider: 'deepseek', model: 'deepseek-chat' }],
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)

    const trigger = view.getByRole('button')
    expect(trigger.textContent).toBe('15.8K tok')
    expect(trigger.querySelector('svg')).not.toBeNull()
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(view.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Turn usage')
    // Portaled out of the trigger's row, with a heading row carrying the total.
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.firstChild?.textContent).toBe('Turn usage15,800 tok')
    const details = dialog.querySelector('[data-turn-usage-details]') as HTMLElement
    expect(details).toBeTruthy()
    expect(details.textContent).toContain('Provider / modeldeepseek/deepseek-chat')
    expect(details.textContent).toContain('Cache hit49.4%')
    expect(details.textContent).toContain('Uncached input5,060 tok')
    expect(details.textContent).toContain('Cached input4,940 tok')
    expect(details.textContent).toContain('Cache write0 tok')
    expect(details.textContent).toContain('Output5,800 tok (42 tok reasoning)')
    expect(details.textContent).not.toContain('Total')
  })

  it('omits unavailable optional facts instead of inventing values', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)

    const trigger = view.getByRole('button')
    expect(trigger.textContent).toBe('150 tok')
    fireEvent.click(trigger)
    expect(view.queryByText('Provider / model')).toBeNull()
    expect(view.queryByText('Cache hit')).toBeNull()
    expect(view.queryByText('Cached input')).toBeNull()
    expect(view.queryByText('Cache write')).toBeNull()
    expect(view.queryByText(/reasoning/)).toBeNull()
  })

  it('keeps a partial cache hit below 100 in the dialog and closes on Escape or outside pointerdown', () => {
    const usage: TurnTokenUsage = {
      uncachedInputTokens: 1,
      cacheReadTokens: 999,
      outputTokens: 100,
      totalTokens: 1_100,
    }
    const view = render(<TurnUsagePanel usage={usage} t={t} />)
    const trigger = view.getByRole('button')
    // The pill carries the compact total; cache-hit rate and exact token
    // counts stay in the dialog.
    expect(trigger.textContent).toBe('1.1K tok')

    fireEvent.click(trigger)
    const dialog = view.getByRole('dialog')
    expect(dialog.textContent).toContain('Cache hit99.9%')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(trigger)
    // A pointerdown inside the panel keeps it open; one outside closes it.
    fireEvent.pointerDown(view.getByRole('dialog'))
    expect(view.queryByRole('dialog')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(view.queryByRole('dialog')).toBeNull()
  })
})

describe('TurnTimePanel', () => {
  it('shows a clock-and-duration pill and opens the time dialog on click', () => {
    const view = render(
      <TurnTimePanel runMs={19_000} tokensPerSecond={20} ttftMs={1_200} t={t} />,
    )
    const trigger = view.getByRole('button')
    expect(trigger.textContent).toBe('19s')
    // The clock icon carries the meaning; the sentence survives for screen readers.
    expect(trigger.getAttribute('aria-label')).toBe('Ran for 19s')
    expect(trigger.querySelector('svg')).not.toBeNull()
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(view.queryByRole('dialog')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const dialog = view.getByRole('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Turn time and speed')
    expect(dialog.parentElement).toBe(document.body)
    const details = dialog.querySelector('[data-turn-time-details]') as HTMLElement
    expect(details.textContent).toContain('Total run time19s')
    expect(details.textContent).toContain('Tokens per second (TPS)20 tok/s')
    expect(details.textContent).toContain('Time to first token (TTFT)1.2s')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('omits unrecorded speed and TTFT rows', () => {
    const view = render(<TurnTimePanel runMs={3_000} t={t} />)
    fireEvent.click(view.getByRole('button'))
    const dialog = view.getByRole('dialog')
    expect(dialog.textContent).toContain('Total run time3s')
    expect(dialog.textContent).not.toContain('Tokens per second')
    expect(dialog.textContent).not.toContain('Time to first token')
  })
})

describe('tail count-up', () => {
  it('holds both numbers until the tail is visible, then rolls them in', () => {
    const realMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    const realRaf = window.requestAnimationFrame
    const realCancel = window.cancelAnimationFrame
    const frames: FrameRequestCallback[] = []
    let clock = performance.now()
    window.matchMedia = ((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    }) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame
    const tick = (delta: number): void => {
      clock += delta
      act(() => {
        for (const cb of frames.splice(0)) cb(clock)
      })
    }
    try {
      const usage: TurnTokenUsage = {
        uncachedInputTokens: 0,
        outputTokens: 15_800,
        totalTokens: 15_800,
      }
      const view = render(<TurnUsagePanel usage={usage} t={t} active={false} />)
      // Behind the reveal gate: nothing has rolled, so nothing is spent unseen.
      expect(view.getByRole('button').textContent).toBe('0 tok')

      view.rerender(<TurnUsagePanel usage={usage} t={t} active />)
      clock = performance.now()
      tick(120)
      const midway = view.getByRole('button').textContent ?? ''
      expect(midway).not.toBe('0 tok')
      expect(midway).not.toBe('15.8K tok')
      tick(900)
      expect(view.getByRole('button').textContent).toBe('15.8K tok')
      view.unmount()
      frames.length = 0

      const time = render(<TurnTimePanel runMs={6_000} t={t} active={false} />)
      expect(time.getByRole('button').textContent).toBe('0s')
      time.rerender(<TurnTimePanel runMs={6_000} t={t} active />)
      clock = performance.now()
      tick(900)
      expect(time.getByRole('button').textContent).toBe('6s')
    } finally {
      window.requestAnimationFrame = realRaf
      window.cancelAnimationFrame = realCancel
      if (realMatchMedia === undefined) Reflect.deleteProperty(window, 'matchMedia')
      else Object.defineProperty(window, 'matchMedia', realMatchMedia)
    }
  })
})
