// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SurfText } from '@deepseek-ai/dsh-client-ui-primitives'

const MESSAGES = ['first wave', 'second wave'] as const

beforeEach(() => { vi.useFakeTimers() })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SurfText', () => {
  it('starts on the first line with the surf entrance and no departing ghost', () => {
    const { container } = render(<SurfText messages={MESSAGES} />)
    const stack = container.firstElementChild as HTMLElement
    const lines = stack.querySelectorAll('[data-surf-line]')
    expect(stack.getAttribute('aria-hidden')).toBe('true')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.getAttribute('data-surf-line')).toBe('in')
    expect(lines[0]?.textContent).toBe('first wave')
  })

  it('replaces the line on the interval, leaving the old one to sink out', () => {
    const { container } = render(<SurfText messages={MESSAGES} interval={1000} />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(container.querySelector('[data-surf-line="in"]')?.textContent).toBe('second wave')
    expect(container.querySelector('[data-surf-line="out"]')?.textContent).toBe('first wave')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(container.querySelector('[data-surf-line="in"]')?.textContent).toBe('first wave')
    expect(container.querySelector('[data-surf-line="out"]')?.textContent).toBe('second wave')
  })

  it('does not rotate a single line', () => {
    const { container } = render(<SurfText messages={['only']} interval={100} />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(container.querySelectorAll('[data-surf-line]')).toHaveLength(1)
  })

  it('forwards font settings to the stack', () => {
    const { container } = render(
      <SurfText messages={['x']} font={{ family: 'serif', size: 22, weight: 600 }} />,
    )
    const stack = container.firstElementChild as HTMLElement
    expect(stack.style.fontFamily).toBe('serif')
    expect(stack.style.fontSize).toBe('22px')
    expect(stack.style.fontWeight).toBe('600')
  })
})
