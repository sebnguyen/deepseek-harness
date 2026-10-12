// The ocean shader's pure helpers are unit-pinned here; the GL path runs
// only in real browsers, where the web lane boots the built client.
import { describe, expect, it } from 'vitest'
import { makeRng, parseCssColor } from '../src/client/ocean-shader.ts'

describe('parseCssColor', () => {
  it('parses six- and three-digit hex', () => {
    const full = parseCssColor('#0063F8')
    expect(full).not.toBeNull()
    expect(full!.r).toBeCloseTo(0 / 255, 5)
    expect(full!.g).toBeCloseTo(99 / 255, 5)
    expect(full!.b).toBeCloseTo(248 / 255, 5)
    expect(full!.a).toBe(1)
    const short = parseCssColor('#fff')
    expect(short).toEqual({ r: 1, g: 1, b: 1, a: 1 })
  })

  it('parses rgb()/rgba() in comma and space-slash notations', () => {
    const comma = parseCssColor('rgba(0, 99, 248, .18)')
    expect(comma!.a).toBeCloseTo(0.18, 5)
    expect(comma!.b).toBeCloseTo(248 / 255, 5)
    const spaced = parseCssColor('rgb(247 248 248)')
    expect(spaced).toEqual({ r: 247 / 255, g: 248 / 255, b: 248 / 255, a: 1 })
    const percent = parseCssColor('rgb(97 200 249 / 32%)')
    expect(percent!.a).toBeCloseTo(0.32, 5)
  })

  it('rejects unsupported notations', () => {
    expect(parseCssColor('color(srgb 0 0 1)')).toBeNull()
    expect(parseCssColor('#12345')).toBeNull()
    expect(parseCssColor('')).toBeNull()
  })
})

describe('makeRng', () => {
  it('is deterministic per seed moment and stays in [0,1)', () => {
    const a = makeRng()
    const b = makeRng()
    const seq = [a(), a(), a()]
    const seq2 = [b(), b(), b()]
    expect(seq).toEqual(seq2)
    for (const v of seq) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
