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
    expect(status.querySelector('[data-surf-line="in"]')?.textContent)
      .toBe('提示：App Platform 可以在每次推送分支时重新部署。')
    act(() => { vi.advanceTimersByTime(3200) })
    expect(status.querySelector('[data-surf-line="in"]')?.textContent)
      .toBe('Droplet 就是带 IP 的浪花。')
    expect(status.querySelector('[data-surf-line="out"]')?.textContent)
      .toBe('提示：App Platform 可以在每次推送分支时重新部署。')
  })

  it('never paints when the history opens inside the flash window', () => {
    const view = render(<HistoryCurtain t={t} />)
    view.unmount()
    act(() => { vi.advanceTimersByTime(140) })
    expect(view.container.firstChild).toBeNull()
  })
})
