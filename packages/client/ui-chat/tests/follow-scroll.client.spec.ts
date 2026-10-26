// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { followScrollport, prefersReducedMotion } from '../src/client/chat/follow-scroll.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** jsdom has no compositor: queue animation frames and hand them to the test. */
function frameClock() {
  const frames = new Map<number, FrameRequestCallback>()
  let next = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    next += 1
    frames.set(next, callback)
    return next
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  const run = (at: number): void => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(at)
  }
  return {
    queued: (): number => frames.size,
    /** Deliver one frame at `at` milliseconds. */
    step: run,
    /** Deliver frames until the follower stops scheduling more. */
    drain: (): void => {
      for (let pass = 0; pass < 240 && frames.size > 0; pass += 1) run(pass * (1_000 / 60))
    },
  }
}

function installMetrics(element: HTMLElement, height: number, clientHeight: number) {
  let scrollHeight = height
  let scrollTop = 0
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => { scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight)) },
  })
  return { setHeight: (value: number) => { scrollHeight = value } }
}

/** Frame-to-frame movement, seeded with the distance from the starting position. */
function steps(writes: readonly number[]): number[] {
  return writes.map((top, index) => top - (index === 0 ? 0 : writes[index - 1] ?? 0))
}

describe('eased floor-follow', () => {
  it('chases a small gap and lands on the un-eased position', () => {
    const clock = frameClock()
    const element = document.createElement('div')
    installMetrics(element, 400, 300)
    const writes: number[] = []
    let settled = 0
    followScrollport(element, (top) => { writes.push(top) }, () => { settled += 1 })

    expect(prefersReducedMotion()).toBe(false)
    expect(clock.queued()).toBe(1)
    clock.step(0)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toBeGreaterThan(0)
    expect(writes[0]).toBeLessThan(100)

    clock.drain()
    expect(settled).toBe(1)
    // Settling writes `scrollHeight`; the clamped floor is what it lands on.
    expect(writes.at(-1)).toBe(100)
    expect(element.scrollTop).toBe(100)
    expect(clock.queued()).toBe(0)
  })

  it('rides the house curve for a jump instead of sprinting then stopping', () => {
    const clock = frameClock()
    const element = document.createElement('div')
    installMetrics(element, 1_000, 300)
    const writes: number[] = []
    followScrollport(element, (top) => { writes.push(top) }, () => {})
    clock.drain()

    const moved = steps(writes)
    expect(moved.length).toBeGreaterThan(8)
    // It leaves rest: the opening frame is a fraction of what a linear sprint
    // would have covered.
    expect(moved[0]).toBeGreaterThan(0)
    expect(moved[0]).toBeLessThan(700 / moved.length / 2)
    // It accelerates out of rest and decelerates into the floor.
    expect(moved[0]).toBeLessThan(moved[3] ?? 0)
    expect(moved.at(-1)).toBeLessThan(Math.max(...moved))
    expect(writes.at(-1)).toBe(700)
  })

  it('caps growth that arrives mid-carry instead of lurching the reader', () => {
    const clock = frameClock()
    const element = document.createElement('div')
    const metrics = installMetrics(element, 400, 300)
    followScrollport(element, () => {}, () => {})
    clock.step(0)
    const before = element.scrollTop

    metrics.setHeight(4_000)
    clock.step(1_000 / 60)
    const moved = element.scrollTop - before
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThan((3_670) / 4)
  })

  it('lands in one write when the reader asks for reduced motion', () => {
    const clock = frameClock()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const element = document.createElement('div')
    installMetrics(element, 1_000, 300)
    const writes: number[] = []
    let settled = 0
    followScrollport(element, (top) => { writes.push(top) }, () => { settled += 1 })
    expect(prefersReducedMotion()).toBe(true)
    expect(writes).toEqual([700])
    expect(settled).toBe(1)
    expect(clock.queued()).toBe(0)
  })

  it('keeps the ease on when the runtime has matchMedia but no reduce', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(prefersReducedMotion()).toBe(false)
  })

  it('lands in one write on a runtime without animation frames', () => {
    vi.stubGlobal('requestAnimationFrame', undefined)
    const element = document.createElement('div')
    installMetrics(element, 1_000, 300)
    const writes: number[] = []
    followScrollport(element, (top) => { writes.push(top) }, () => {})
    expect(writes).toEqual([700])
  })

  it('keeps tracking a floor that grows while the carry is in flight', () => {
    const clock = frameClock()
    const element = document.createElement('div')
    const metrics = installMetrics(element, 1_000, 300)
    followScrollport(element, () => {}, () => {})
    clock.step(0)
    const first = element.scrollTop
    metrics.setHeight(1_400)
    clock.step(1_000 / 60)
    expect(element.scrollTop).toBeGreaterThan(first)
    clock.drain()
    expect(element.scrollTop).toBe(1_100)
  })

  it('still progresses on a repeated or a throttled frame timestamp', () => {
    const clock = frameClock()
    const element = document.createElement('div')
    installMetrics(element, 400, 300)
    followScrollport(element, () => {}, () => {})
    clock.step(64)
    const first = element.scrollTop
    clock.step(64)
    expect(element.scrollTop).toBeGreaterThan(first)
    const repeated = element.scrollTop
    clock.step(10_000)
    expect(element.scrollTop).toBeGreaterThan(repeated)
  })

  it('stops carrying on demand and leaves the position where it stopped', () => {
    const clock = frameClock()
    const element = document.createElement('div')
    installMetrics(element, 400, 300)
    const writes: number[] = []
    const handle = followScrollport(element, (top) => { writes.push(top) }, () => {})
    clock.step(0)
    const stopped = element.scrollTop

    handle.stop()
    expect(clock.queued()).toBe(0)
    clock.drain()
    expect(element.scrollTop).toBe(stopped)
    expect(writes.at(-1)).toBe(stopped)

    // A second stop has no frame left to cancel.
    handle.stop()
    expect(element.scrollTop).toBe(stopped)
  })
})
