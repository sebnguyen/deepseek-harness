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
 * Keep this deck in step with the boot page's BOOT_TIPS and the vscode
 * namespace's boot.tip.* lines; all three rotate the same thirty sentences.
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
  'session.surf.10',
  'session.surf.11',
  'session.surf.12',
  'session.surf.13',
  'session.surf.14',
  'session.surf.15',
  'session.surf.16',
  'session.surf.17',
  'session.surf.18',
  'session.surf.19',
  'session.surf.20',
  'session.surf.21',
  'session.surf.22',
  'session.surf.23',
  'session.surf.24',
  'session.surf.25',
  'session.surf.26',
  'session.surf.27',
  'session.surf.28',
  'session.surf.29',
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
      <div className={css.wordmark} aria-hidden="true">{t('hero.headline')}</div>
      <SurfText
        className={css.tips}
        messages={LOADING_LINES.map(key => t(key))}
        interval={LINE_HOLD_MS}
        font={{
          family: 'var(--dsw-font-family)',
          size: '12px',
          lineHeight: '18px',
        }}
      />
    </div>
  )
}
