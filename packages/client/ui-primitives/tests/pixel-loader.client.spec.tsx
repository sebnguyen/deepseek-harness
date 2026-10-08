// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { pixelLoaderGap, pixelLoaderInner, PixelLoader } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('PixelLoader', () => {
  it('renders the 24-grid sweep with the hoisted stylesheet, decorative', () => {
    const { container } = render(<PixelLoader />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
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

  it('renders the coarser 16 grid for small chrome at a custom size and class', () => {
    const { container } = render(<PixelLoader grid={16} size={16} className="seat" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg?.getAttribute('width')).toBe('16')
    expect(svg?.getAttribute('class')).toBe('seat')
    expect(svg?.querySelectorAll('style')).toHaveLength(0)
  })

  it('widens the pixel gap as the rendered pitch drops below one cell', () => {
    expect(pixelLoaderGap(24, 24)).toBe(0.3)
    expect(pixelLoaderGap(24, 12)).toBe(0.5)
    expect(pixelLoaderGap(16, 16)).toBe(0.3)
    expect(pixelLoaderGap(16, 12)).toBeCloseTo(0.4)
    // 12px on the 24 grid renders 0.5-unit squares against 0.7 at full pitch.
    expect(pixelLoaderInner(24, 12)).toContain('width="0.5"')
    expect(pixelLoaderInner(24, 24)).toContain('width="0.7"')
    // Buckets keep their clockwise staggered delays.
    expect(pixelLoaderInner(24, 24)).toContain('animation-delay: calc(0.08s')
    expect(pixelLoaderInner(16, 16)).toContain('width="0.7"')
  })
})
