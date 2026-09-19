import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

const noop = (): void => {}

/**
 * One document-wide `IntersectionObserver`, shared by every caller: a
 * scrolling transcript with many gated elements gets one observer instance,
 * not one per element. Activated elements leave it permanently — activation
 * never reverses on scroll-away.
 */
class ViewportActivator {
  private observer: IntersectionObserver | undefined
  private readonly activators = new Map<Element, () => void>()

  observe(element: Element, activate: () => void): () => void {
    if (typeof IntersectionObserver === 'undefined') {
      activate()
      return noop
    }
    this.observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const current = this.activators.get(entry.target)
        /* v8 ignore next -- the observer reports only elements still registered with it. */
        if (current === undefined) continue
        this.activators.delete(entry.target)
        this.observer?.unobserve(entry.target)
        current()
      }
      this.releaseEmptyObserver()
    })
    this.activators.set(element, activate)
    this.observer.observe(element)
    return () => {
      this.activators.delete(element)
      this.observer?.unobserve(element)
      this.releaseEmptyObserver()
    }
  }

  private releaseEmptyObserver(): void {
    if (this.activators.size > 0) return
    this.observer?.disconnect()
    this.observer = undefined
  }
}

const viewportActivator = new ViewportActivator()

/**
 * Defer expensive per-instance work (syntax highlighting, diagram layout)
 * until the target first intersects the viewport — a long transcript that
 * mounts many such instances at once (initial load, or a fast scroll past
 * many of them) would otherwise fire all their expensive work simultaneously
 * instead of only for what's actually on screen. Activation lasts for the
 * component's lifetime; browsers without `IntersectionObserver` activate
 * immediately.
 * @param target - element whose non-activated rendering already reserves its geometry, so
 * activation cannot cause a layout jump.
 * @param enabled - false skips observing entirely (e.g. a caller whose expensive work never applies
 * to this instance) rather than registering and never activating.
 * @returns whether this instance may start its expensive work.
 */
export function useViewportActivation(target: RefObject<Element>, enabled = true): boolean {
  const [activated, setActivated] = useState(false)
  const activate = useCallback(() => { setActivated(true) }, [])

  useEffect(() => {
    if (activated || !enabled) return
    const element = target.current
    /* v8 ignore next -- React attaches the host ref before running effects. */
    if (element === null) return
    return viewportActivator.observe(element, activate)
  }, [activate, activated, enabled, target])

  return activated
}
