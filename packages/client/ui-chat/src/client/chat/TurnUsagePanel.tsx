// Icon-row Turn-stat actions: a database pill labelled with the turn total
// click-opens the per-Turn usage dialog, and a clock pill labelled with the
// turn wall time click-opens the Turn-time dialog. Both sit right of the
// branch action in the tail's IconActions row, ahead of the plain clock text.

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { IconDatabaseOutline16, PixelGlyph } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTokenUsage } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatLatencySeconds, formatRunDuration, formatTokensPerSecond } from './message-chrome.ts'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from '../contract/token-format.ts'
import { MEASURE_STYLE, useStatDialog } from './stat-dialog.ts'
import css from './TurnUsagePanel.module.css'
import dialogCss from './stat-dialog.module.css'

export interface TurnUsagePanelProps {
  usage: TurnTokenUsage
  /** False while the tail is still behind the reveal gate; the roll waits. */
  active?: boolean
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

export interface TurnTimePanelProps {
  /** Turn wall time in ms, the pill's label. */
  runMs: number
  /** Turn decode throughput, a dialog row when known. */
  tokensPerSecond?: number | undefined
  /** Turn first-step TTFT in ms, a dialog row when known. */
  ttftMs?: number | undefined
  /** False while the tail is still behind the reveal gate; the roll waits. */
  active?: boolean
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

/** Roll-in span for the tail numbers: long enough to read as a count, not a blur. */
const COUNT_UP_MS = 900
/** Digits step on this cadence; the value itself is a function of elapsed time. */
const COUNT_UP_TICK_MS = 50

/**
 * Whether a count-up may run: only where the platform reports a motion preference
 * (a DOM without matchMedia, such as the test renderer, gets the final value) and
 * a frame clock exists.
 * @returns True when the pill should animate.
 */
function countUpAllowed(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  return typeof window.requestAnimationFrame === 'function'
}

/**
 * Count a token total (or a duration) up from zero over {@link COUNT_UP_MS}.
 * @param value - The final token count.
 * @param active - False until the tail is actually visible; nothing rolls then.
 * @returns The count to render this frame.
 */
function useCountUp(value: number, active: boolean): number {
  const [shown, setShown] = useState(() => (countUpAllowed() ? 0 : value))
  useEffect(() => {
    if (!countUpAllowed() || value === 0) {
      setShown(value)
      return
    }
    // The tail mounts hidden behind the reveal gate: rolling now would be a
    // finished number by the time it is seen.
    if (!active) return
    const start = performance.now()
    let frame = 0
    let painted = start
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / COUNT_UP_MS)
      // The count is a function of elapsed time, so the curve stays eased; the
      // digits only move on a tick, because writing them every frame reads as
      // a blur rather than a count.
      if (progress >= 1 || now - painted >= COUNT_UP_TICK_MS) {
        painted = now
        // Ease-out cubic: the theme's --a-ease is cubic-bezier(0.22, 0.61, 0.36, 1).
        setShown(Math.round(value * (1 - (1 - progress) ** 3)))
      }
      if (progress < 1) frame = window.requestAnimationFrame(step)
    }
    frame = window.requestAnimationFrame(step)
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [value, active])
  return shown
}

function formatCompactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatTokens(value, t) })
}

function formatExactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) })
}

/**
 * Turn-usage IconActions pill with a click-open Turn-usage details dialog.
 * @param props - Turn usage buckets and locale seat.
 * @returns The trigger and, while open, its portaled dialog anchored above the trigger.
 */
export function TurnUsagePanel({ usage, t, active = true }: TurnUsagePanelProps) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog()

  const cacheHit = usage.cacheReadTokens === undefined
    ? null
    : formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1)
  const total = formatCompactCount(useCountUp(usage.totalTokens, active), t)
  const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? ''

  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <IconDatabaseOutline16 />
        <span className={css.label}>{t('message.turnUsage.consumed', { total })}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('message.turnUsage.title')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconDatabaseOutline16 />
              {t('message.turnUsage.title')}
            </span>
            <span className={dialogCss.titleValue}>{formatExactCount(usage.totalTokens, t)}</span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-turn-usage-details>
            {routes !== '' && (
              <>
                <dt>{t('message.turnUsage.model')}</dt>
                <dd className={dialogCss.route}>{routes}</dd>
              </>
            )}
            {cacheHit !== null && (
              <>
                <dt>{t('message.turnUsage.cacheHit')}</dt>
                <dd>{`${cacheHit}%`}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.input')}</dt>
            <dd>{formatExactCount(usage.uncachedInputTokens, t)}</dd>
            {usage.cacheReadTokens !== undefined && (
              <>
                <dt>{t('message.turnUsage.cacheRead')}</dt>
                <dd>{formatExactCount(usage.cacheReadTokens, t)}</dd>
              </>
            )}
            {usage.cacheWriteTokens !== undefined && (
              <>
                <dt>{t('message.turnUsage.cacheWrite')}</dt>
                <dd>{formatExactCount(usage.cacheWriteTokens, t)}</dd>
              </>
            )}
            <dt>{t('message.turnUsage.output')}</dt>
            <dd>
              {formatExactCount(usage.outputTokens, t)}
              {usage.reasoningTokens !== undefined && (
                <span className={dialogCss.reasoning}>
                  {t('message.turnUsage.reasoning', { tokens: formatExactCount(usage.reasoningTokens, t) })}
                </span>
              )}
            </dd>
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}

/**
 * Turn-time IconActions pill with a click-open Turn-time details dialog.
 * @param props - Turn timing facts and locale seat.
 * @returns The clock-and-duration trigger and, while open, its portaled dialog anchored above the trigger.
 */
export function TurnTimePanel({ runMs, tokensPerSecond, ttftMs, t, active = true }: TurnTimePanelProps) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog()
  const shownMs = useCountUp(runMs, active)
  return (
    <span ref={rootRef} className={css.root}>
      <button
        type="button"
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('message.ranFor', { duration: formatRunDuration(shownMs, t) })}
        onClick={() => { setOpen(!open) }}
      >
        <PixelGlyph name="clock" size={16} />
        <span className={css.label}>{formatRunDuration(shownMs, t)}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('message.turnTime.title')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <PixelGlyph name="clock" size={16} />
              {t('message.turnTime.title')}
            </span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-turn-time-details>
            <dt>{t('message.turnTime.duration')}</dt>
            <dd>{formatRunDuration(runMs, t)}</dd>
            {tokensPerSecond !== undefined && (
              <>
                <dt>{t('message.turnTime.speed')}</dt>
                <dd>{t('message.tokensPerSecond', { tps: formatTokensPerSecond(tokensPerSecond) })}</dd>
              </>
            )}
            {ttftMs !== undefined && (
              <>
                <dt>{t('message.turnTime.ttft')}</dt>
                <dd>{t('duration.seconds', { seconds: formatLatencySeconds(ttftMs) })}</dd>
              </>
            )}
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}
