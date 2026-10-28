// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryCurtain, type HistoryCurtainProps } from '../src/client/skeleton/HistoryCurtain.tsx'
import { zh } from '../src/client/locales.ts'

const t: HistoryCurtainProps['t'] = key => zh[key]

beforeEach(() => { vi.useFakeTimers() })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('HistoryCurtain', () => {
  it('holds the curtain back through the flash window, then paints the sweep and a stack tip', () => {
    const view = render(<HistoryCurtain t={t} />)
    expect(view.container.firstChild).toBeNull()
    act(() => { vi.advanceTimersByTime(139) })
    expect(view.container.firstChild).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    const status = view.getByRole('status')
    expect(status.hasAttribute('data-history-curtain')).toBe(true)
    expect(status.getAttribute('aria-label')).toBe('载入历史…')
    expect(status.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(status.querySelector('svg')?.getAttribute('width')).toBe('128')
    expect(status.querySelector('svg')?.getAttribute('height')).toBe('128')
    expect(status.textContent).toContain(zh['hero.headline'])
    expect(status.querySelector('[data-surf-line="in"]')?.textContent)
      .toBe(zh['session.surf.0'])
    act(() => { vi.advanceTimersByTime(3200) })
    expect(status.querySelector('[data-surf-line="in"]')?.textContent)
      .toBe(zh['session.surf.1'])
    expect(status.querySelector('[data-surf-line="out"]')?.textContent)
      .toBe(zh['session.surf.0'])
  })

  it('rotates through the full thirty-tip deck', () => {
    const view = render(<HistoryCurtain t={t} />)
    act(() => { vi.advanceTimersByTime(140) })
    const status = view.getByRole('status')
    act(() => { vi.advanceTimersByTime(3200 * 29) })
    expect(status.querySelector('[data-surf-line="in"]')?.textContent)
      .toBe(zh['session.surf.29'])
  })

  it('never paints when the history opens inside the flash window', () => {
    const view = render(<HistoryCurtain t={t} />)
    view.unmount()
    act(() => { vi.advanceTimersByTime(140) })
    expect(view.container.firstChild).toBeNull()
  })
})
