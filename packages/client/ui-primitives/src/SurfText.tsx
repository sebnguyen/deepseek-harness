import clsx from 'clsx'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import css from './SurfText.module.css'

/** Font settings forwarded to a {@link SurfText} run. */
export interface SurfTextFont {
  /** CSS `font-family`; inherited when omitted. */
  family?: CSSProperties['fontFamily']
  /** CSS `font-size`; inherited when omitted. */
  size?: CSSProperties['fontSize']
  /** CSS `font-weight`; inherited when omitted. */
  weight?: CSSProperties['fontWeight']
  /** CSS `font-style`; inherited when omitted. */
  style?: CSSProperties['fontStyle']
  /** CSS `line-height`; inherited when omitted. */
  lineHeight?: CSSProperties['lineHeight']
  /** CSS `letter-spacing`; inherited when omitted. */
  letterSpacing?: CSSProperties['letterSpacing']
}

/** Props for {@link SurfText}. */
export interface SurfTextProps {
  /** Lines to rotate through; each arriving line surfs up as the last sinks away. */
  messages: readonly string[]
  /** Font settings applied to the stack. */
  font?: SurfTextFont | undefined
  /** Milliseconds each line is held before the next arrives (default 2600). */
  interval?: number | undefined
  /** Extra class for layout placement. */
  className?: string | undefined
}

/** Below this the departing line cannot finish its fade before the next arrival. */
const MIN_INTERVAL_MS = 400

/**
 * Rotate a list of lines through one spot: every arrival rides the shared
 * `surf-up` keyframe while the departing line sinks out, so the copy changes
 * in the transcript's own motion vocabulary instead of swapping abruptly.
 * The stack is decorative — rotating text is hidden from assistive tech, and
 * the host pairs it with a stable status label.
 * @param props.messages - the lines to rotate, in order.
 * @param props.font - font settings forwarded to the stack.
 * @param props.interval - hold per line in milliseconds.
 * @param props.className - extra class for layout placement.
 * @returns the rotating stack, or null when there is nothing to show.
 */
export function SurfText({
  messages, font, interval = 2600, className,
}: SurfTextProps) {
  const [step, setStep] = useState(0)
  const count = messages.length
  // A different roster starts over instead of inheriting a stale phase.
  useEffect(() => {
    setStep(0)
  }, [count])
  useEffect(() => {
    if (count < 2) return
    const timer = setInterval(
      () => { setStep(current => current + 1) },
      Math.max(MIN_INTERVAL_MS, interval),
    )
    return () => { clearInterval(timer) }
  }, [count, interval])
  if (count === 0) return null
  const style = {
    fontFamily: font?.family,
    fontSize: font?.size,
    fontStyle: font?.style,
    fontWeight: font?.weight,
    letterSpacing: font?.letterSpacing,
    lineHeight: font?.lineHeight,
  } as CSSProperties
  const current = messages[step % count] ?? ''
  const previous = step === 0 ? undefined : messages[(step - 1) % count] ?? ''
  return (
    <span className={clsx(css.stack, className)} style={style} data-surf-text="" aria-hidden="true">
      {previous !== undefined && (
        <span key={`${step}-out`} className={css.line} data-surf-line="out">
          {previous}
        </span>
      )}
      <span key={`${step}-in`} className={css.line} data-surf-line="in">
        {current}
      </span>
    </span>
  )
}
