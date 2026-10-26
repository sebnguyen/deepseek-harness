/**
 * Number tweens for the composer stats chips: a figure that lands on a new
 * reading rolls to it from the last one it showed, so a settled step reads as a
 * change instead of a glyph swap. Figures keep their formatter; only the number
 * is interpolated, so unit suffixes and locale rules stay exact.
 */
import { useEffect, useRef, useState } from 'react'

/** Roll span for one chip figure. */
const TWEEN_MS = 520
/** Repaint cadence: these are text figures, so ~20Hz reads smooth enough. */
const TWEEN_TICK_MS = 50

/**
 * Whether number tweens may run in this environment.
 * @returns False without a media query reader or a frame clock (plain jsdom),
 * and false when the visitor asked for reduced motion.
 */
export function numberTweenAllowed(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.matchMedia !== 'function') return false
  if (typeof window.requestAnimationFrame !== 'function') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Roll a figure from its previous reading to the new one.
 * @param value - The reading to land on.
 * @returns The figure to render now; the target itself when tweens are off.
 */
export function useNumberTween(value: number): number {
  const [shown, setShown] = useState(value)
  const previous = useRef(value)
  useEffect(() => {
    const from = previous.current
    previous.current = value
    if (!numberTweenAllowed() || from === value) {
      setShown(value)
      return
    }
    const start = performance.now()
    let frame = 0
    let painted = start
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / TWEEN_MS)
      if (progress >= 1 || now - painted >= TWEEN_TICK_MS) {
        painted = now
        setShown(from + (value - from) * (1 - (1 - progress) ** 3))
      }
      if (progress < 1) frame = window.requestAnimationFrame(step)
    }
    frame = window.requestAnimationFrame(step)
    return () => { window.cancelAnimationFrame(frame) }
  }, [value])
  return shown
}
