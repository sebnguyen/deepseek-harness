// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncSeatMetrics } from '../src/client/skeleton/seatMetrics.ts'

/** Recorded observers: the callback plus what it watches, per instance. */
interface Observed {
  callback: ResizeObserverCallback
  targets: Element[]
  disconnected: boolean
}

const observers: Observed[] = []

class ResizeObserverStub {
  targets: Element[] = []
  record!: Observed
  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, targets: this.targets, disconnected: false }
    observers.push(this.record)
  }

  observe(target: Element): void { this.targets.push(target) }
  unobserve(): void {}
  disconnect(): void { this.record.disconnected = true }
}

let seat: HTMLDivElement
let scroller: HTMLDivElement
let dispose: () => void

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  seat = document.createElement('div')
  scroller = document.createElement('div')
  scroller.append(seat)
  document.body.append(scroller)
  dispose = syncSeatMetrics(seat, scroller)
})

afterEach(() => {
  dispose()
  document.body.innerHTML = ''
  observers.length = 0
  vi.unstubAllGlobals()
})

/** Fire the recorded seat observer as a resize would. */
function fireResize(): void {
  const entry = observers[0]!
  entry.callback([], null as never)
}

function heightTransition(type: string): void {
  seat.dispatchEvent(new TransitionEvent(type, { propertyName: 'height' }))
}

describe('syncSeatMetrics', () => {
  it('observes the seat and the scroll body and publishes both heights', () => {
    const entry = observers[0]!
    expect(entry.targets).toEqual([seat, scroller])
    fireResize()
    expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe(`${seat.offsetHeight}px`)
    expect(scroller.style.getPropertyValue('--dsh-conversation-viewport-height')).toBe(`${scroller.clientHeight}px`)
  })

  it('rebroadcasts ordinary resizes while no transition runs', () => {
    fireResize()
    expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe('0px')
    fireResize()
    expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe('0px')
  })

  it('holds broadcasts during a height transition, then re-anchors once', () => {
    heightTransition('transitionrun')
    scroller.style.setProperty('--dsh-composer-height', 'stale')
    fireResize()
    // The suppressed frame keeps the rails on their last value.
    expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe('stale')
    heightTransition('transitionend')
    expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe('0px')
    // Idle frames broadcast again once settled.
    scroller.style.setProperty('--dsh-composer-height', 'stale')
    fireResize()
    expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe('0px')
  })

  it('treats a cancelled height transition like a settled one', () => {
    heightTransition('transitionrun')
    fireResize()
    heightTransition('transitioncancel')
    expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe('0px')
  })

  it('ignores transitions on other properties', () => {
    seat.dispatchEvent(new TransitionEvent('transitionrun', { propertyName: 'opacity' }))
    scroller.style.setProperty('--dsh-composer-height', 'stale')
    fireResize()
    expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe('0px')
  })

  it('disconnects the observer and drops the listeners on dispose', () => {
    dispose()
    expect(observers[0]!.disconnected).toBe(true)
    heightTransition('transitionrun')
    scroller.style.setProperty('--dsh-composer-height', 'stale')
    fireResize()
    // With no listeners left, frames flow through again.
    expect(scroller.style.getPropertyValue('--dsh-composer-height')).toBe('0px')
  })
})
