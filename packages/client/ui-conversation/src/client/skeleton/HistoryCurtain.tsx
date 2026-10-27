import { useEffect, useState } from 'react'
import { PixelLoader, SurfText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import css from './HistoryCurtain.module.css'

/** Flash guard: a history window already in memory never paints the curtain. */
const SHOW_DELAY_MS = 140

/** How long one DigitalOcean stack line stays on screen. */
const LINE_HOLD_MS = 3200

/**
 * Cheeky but true DigitalOcean stack lines. The literal status lives on the
 * status label, so the rotating copy can be playful without carrying state.
 */
const LOADING_LINES = [
  'session.surf.0',
  'session.surf.1',
  'session.surf.2',
  'session.surf.3',
  'session.surf.4',
  'session.surf.5',
  'session.surf.6',
  'session.surf.7',
  'session.surf.8',
  'session.surf.9',
] as const satisfies readonly ConversationKey[]

/** Props for {@link HistoryCurtain}. */
export interface HistoryCurtainProps {
  /** Translator bound to the conversation namespace's dictionaries. */
  t: (key: ConversationKey) => string
}

/**
 * Cover a Session's view area until its history finishes opening: the
 * DigitalOcean pixel sweep over a rotating line of DigitalOcean stack tips.
 * @param props.t - the conversation namespace translator.
 * @returns the curtain once the flash guard elapses, else null.
 */
export function HistoryCurtain({ t }: HistoryCurtainProps) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => { setShown(true) }, SHOW_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [])
  if (!shown) return null
  return (
    <div
      className={css.curtain}
      role="status"
      aria-live="polite"
      aria-label={t('session.loadingHistory')}
      data-history-curtain=""
    >
      <PixelLoader size={128} className={css.mark} />
      <SurfText
        className={css.tips}
        messages={LOADING_LINES.map(key => t(key))}
        interval={LINE_HOLD_MS}
        font={{
          family: 'var(--dsw-font-family)',
          size: 'var(--dsh-content-font-size, 14px)',
          weight: 500,
          letterSpacing: '0.01em',
        }}
      />
    </div>
  )
}
