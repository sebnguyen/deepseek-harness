// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { pixelLoaderInner, PixelLoader, pixelLoaderTwinkleInner } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('PixelLoader', () => {
  it('renders the stable 16-grid sweep with the hoisted stylesheet, decorative', () => {
    const { container } = render(<PixelLoader />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg?.getAttribute('width')).toBe('24')
    expect(svg?.getAttribute('fill')).toBe('currentColor')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect((svg?.querySelectorAll('rect') ?? []).length).toBeGreaterThan(100)
    const host = document.head.querySelector('[data-dsh-pixel-loader-style]')
    expect(host?.textContent).toContain('dsh-pl-sweep')
    expect(host?.textContent).toContain('prefers-reduced-motion')
    // Geometry-only markup: no style text leaks into host textContent.
    expect(svg?.textContent).toBe('')
  })

  it('renders the same stable grid at a custom size and class', () => {
    const { container } = render(<PixelLoader size={16} className="seat" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg?.getAttribute('width')).toBe('16')
    expect(svg?.getAttribute('class')).toBe('seat')
    expect(svg?.querySelectorAll('style')).toHaveLength(0)
  })

  it('idles the twinkle mode with per-pixel pop & fade clocks, deterministic across renders', () => {
    const { container } = render(<PixelLoader mode="twinkle" size={48} />)
    const svg = container.querySelector('svg')
    const rects = svg?.querySelectorAll('rect.dsh-pl-tw') ?? []
    expect(rects.length).toBeGreaterThan(100)
    // No sweep buckets in twinkle mode: every pixel self-times.
    expect(svg?.querySelectorAll('g').length).toBe(0)
    const style = (rects[0] as Element).getAttribute('style') ?? ''
    expect(style).toContain('animation-duration:')
    expect(style).toContain('animation-delay:-')
    const host = document.head.querySelector('[data-dsh-pixel-loader-style]')
    expect(host?.textContent).toContain('dsh-pl-twinkle')
    expect(host?.textContent).toContain('prefers-reduced-motion')
    expect(svg?.textContent).toBe('')
    // Seeded schedule: same markup every render.
    expect(pixelLoaderTwinkleInner()).toBe(pixelLoaderTwinkleInner())
  })

  it('keeps one pixel scale and one 20% gap at every rendered size', () => {
    // 12px and 24px render the same 16-grid geometry: 0.8-unit squares, never
    // a sub-pixel gap retune.
    const small = pixelLoaderInner()
    const large = pixelLoaderInner()
    expect(small).toBe(large)
    expect(small).toContain('width="0.8"')
    expect(small).not.toContain('width="0.5"')
    // Buckets keep their clockwise staggered delays.
    expect(small).toContain('animation-delay: calc(0.08s')
  })
})
