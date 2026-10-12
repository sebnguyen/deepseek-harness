/**
 * The sidebar harness guide: a foot-style trigger that opens a launch
 * dialog floating over the session. The dialog shows the capability
 * roster as a spec grid; clicking a card FLIP-expands it into a
 * full-frame stage (god-ray media sea on the left, title and
 * explanation on the right, Prev/Next browsing). Esc folds the stage
 * back, then closes the dialog. The session list stays in the column.
 * Wide and rail both show the trigger.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ComponentType } from 'react'
import { createPortal } from 'react-dom'
import {
  IconAgentPresetOutline16, IconArchiveOutline20, IconBranchOutline16, IconCodeOutline16,
  IconCordisPluginOutline14, IconGoalOutline16, IconGlobeOutline14, IconShieldOutline16,
  IconSkillOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar shell's SlotMap merge ('sidebar.guide').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { GuideKey } from './locales.ts'
import css from './GuideHome.module.css'

/** One capability card: glyph, copy keys, keyword chips, and its sea hue. */
interface FeatureCard {
  /** The card's leading glyph, and the media watermark when expanded. */
  icon: ComponentType<IconProps>
  /** Dictionary key of the card title. */
  title: GuideKey
  /** Dictionary key of the one-line description. */
  description: GuideKey
  /** Dictionary key of the ·-separated keyword chips. */
  chips: GuideKey
  /** Media-pane sea hue in degrees for this capability's film. */
  hue: number
}

/** The harness capability roster, in grid order. */
const FEATURES: readonly FeatureCard[] = [
  { icon: IconShieldOutline16, title: 'guide.sandbox.title', description: 'guide.sandbox.description', chips: 'guide.sandbox.chips', hue: 214 },
  { icon: IconCodeOutline16, title: 'guide.shell.title', description: 'guide.shell.description', chips: 'guide.shell.chips', hue: 196 },
  { icon: IconAgentPresetOutline16, title: 'guide.delegation.title', description: 'guide.delegation.description', chips: 'guide.delegation.chips', hue: 258 },
  { icon: IconBranchOutline16, title: 'guide.workflows.title', description: 'guide.workflows.description', chips: 'guide.workflows.chips', hue: 174 },
  { icon: IconGoalOutline16, title: 'guide.goals.title', description: 'guide.goals.description', chips: 'guide.goals.chips', hue: 148 },
  { icon: IconSkillOutline16, title: 'guide.skills.title', description: 'guide.skills.description', chips: 'guide.skills.chips', hue: 32 },
  { icon: IconGlobeOutline14, title: 'guide.web.title', description: 'guide.web.description', chips: 'guide.web.chips', hue: 190 },
  { icon: IconArchiveOutline20, title: 'guide.log.title', description: 'guide.log.description', chips: 'guide.log.chips', hue: 268 },
  { icon: IconCordisPluginOutline14, title: 'guide.plugins.title', description: 'guide.plugins.description', chips: 'guide.plugins.chips', hue: 8 },
]

/** Morph duration shared with the stage's inline transition. */
const MORPH_MS = 520
/** God-ray shafts in the media sea. */
const RAY_COUNT = 22

/** One light shaft: geometry, strength, and sway timing (percent/deg/second units). */
interface RaySpec {
  left: number
  width: number
  opacity: number
  drift: number
  duration: number
  delay: number
}

/** Seeded god-ray layout, stable across sessions so the sea always composes identically. */
function makeRays(seed: number, count: number): RaySpec[] {
  let s = seed
  const rnd = (): number => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const rays: RaySpec[] = []
  for (let i = 0; i < count; i += 1) {
    const width = 1.5 + rnd() * 13
    const left = -14 + rnd() * 120
    const drift = (rnd() * 2 - 1) * 13
    const duration = 6.5 + rnd() * 7.5
    const opacity = 0.1 + rnd() * 0.24
    rays.push({ left, width, drift, duration, opacity, delay: -(rnd() * duration) })
  }
  return rays
}
const RAYS: readonly RaySpec[] = makeRays(7, RAY_COUNT)

/** 1-based zero-padded counters (01..09) for the grid and crumb. */
const pad2 = (index: number): string => String(index + 1).padStart(2, '0')

/** The pixel-star mark the guide carries in its kicker and signature. */
function PixelStar({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="6" y="0" width="2" height="4" />
      <rect x="6" y="10" width="2" height="4" />
      <rect x="0" y="6" width="4" height="2" />
      <rect x="10" y="6" width="4" height="2" />
      <rect x="4" y="4" width="6" height="6" />
    </svg>
  )
}

/** Accents the final word of the display title, the launch headline's style. */
function accentTitle(title: string) {
  const at = title.lastIndexOf(' ')
  if (at <= 0) return title
  return <>{title.slice(0, at)} <em>{title.slice(at + 1)}</em></>
}

/** The seat's composed props: the shell's column state plus its dictionary reader. */
export type GuideHomeProps = Partial<PropsRuntime<'sidebar.guide'>> & {
  /** Bound dictionary reader for the `sidebar.guide` namespace. */
  t?: (key: GuideKey, values?: Record<string, string>) => string
}

export function GuideHome({ wide, t }: GuideHomeProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<number | null>(null)
  const [playing, setPlaying] = useState(true)
  const morphing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const cells = useRef<Array<HTMLElement | null>>([])

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  const openStage = (index: number): void => {
    if (morphing.current || active !== null) return
    morphing.current = true
    setActive(index)
    requestAnimationFrame(() => {
      const p = panel.current
      const s = stage.current
      /* v8 ignore next -- every card registers its ref at dialog mount. */
      const c = cells.current[index] ?? null
      /* v8 ignore next -- stage/cell refs persist while the panel is mounted; p-null covers unmount. */
      if (p === null || s === null || c === null) {
        morphing.current = false
        return
      }
      const pr = p.getBoundingClientRect()
      if (pr.width === 0) {
        // Hidden/jsdom surface: the stage renders unfolded with no morph.
        morphing.current = false
        return
      }
      const cr = c.getBoundingClientRect()
      s.style.transition = 'none'
      s.style.transform =
        `translate(${cr.left - pr.left}px, ${cr.top - pr.top}px) ` +
        `scale(${cr.width / pr.width}, ${cr.height / pr.height})`
      requestAnimationFrame(() => {
        s.style.transition = `transform ${MORPH_MS}ms cubic-bezier(0.22, 0.9, 0.28, 1), opacity 0.18s ease`
        s.style.transform = 'none'
      })
      timer.current = setTimeout(() => { morphing.current = false }, MORPH_MS + 60)
    })
  }

  const closeStage = (): void => {
    if (morphing.current) return
    /* v8 ignore next -- callers (mask, Esc, close button) already exclude the no-stage case. */
    if (active === null) return
    morphing.current = true
    const finish = (): void => {
      const s = stage.current
      if (s !== null) {
        s.style.transition = 'none'
        s.style.transform = 'none'
      }
      setActive(null)
      morphing.current = false
    }
    const p = panel.current
    const s = stage.current
    /* v8 ignore next -- every card registers its ref at dialog mount. */
    const c = cells.current[active] ?? null
    /* v8 ignore next -- closeStage runs only with the dialog mounted; refs are always assigned. */
    if (p === null || s === null || c === null) { finish(); return }
    const pr = p.getBoundingClientRect()
    if (pr.width === 0) { finish(); return }
    const cr = c.getBoundingClientRect()
    s.style.transition = `transform ${MORPH_MS}ms cubic-bezier(0.22, 0.9, 0.28, 1), opacity 0.18s ease`
    s.style.transform =
      `translate(${cr.left - pr.left}px, ${cr.top - pr.top}px) ` +
      `scale(${cr.width / pr.width}, ${cr.height / pr.height})`
    timer.current = setTimeout(finish, MORPH_MS + 60)
  }

  const step = (dir: 1 | -1): void => {
    /* v8 ignore next -- step fires only with an active card (Prev/Next buttons, arrow keys). */
    if (active === null) return
    if (morphing.current) return
    setActive((active + dir + FEATURES.length) % FEATURES.length)
  }

  // Esc folds the stage, then the dialog; arrows browse while expanded.
  // Plain-document listener, rebound every render so it sees fresh state.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (active === null) setOpen(false)
        else closeStage()
      } else if (e.key === 'ArrowRight' && active !== null) {
        e.preventDefault()
        step(1)
      } else if (e.key === 'ArrowLeft' && active !== null) {
        e.preventDefault()
        step(-1)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  })

  if (t === undefined) return null
  /* v8 ignore next -- active indexes FEATURES (0..length-1) by construction. */
  const card = active === null ? null : (FEATURES[active] ?? null)
  const total = pad2(FEATURES.length - 1)
  // The stage reads its glyph only while a card is active; the fallback slot is never painted.
  const MediaIcon = card === null ? IconSkillOutline16 : card.icon

  return (
    <div className={css.root}>
      <button
        type="button"
        className={wide === true ? css.trigger : `${css.trigger} ${css.rail}`}
        aria-label={t('section.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        {/* Icon-only trigger: the accessible name stays on the button's aria-label. */}
        <IconSkillOutline16 size={wide === true ? 13 : 14} />
      </button>
      {open && createPortal(
        <div className={css.overlay} role="presentation">
          <div
            className={css.mask}
            data-testid="guide-mask"
            aria-hidden="true"
            onClick={() => { if (active === null) setOpen(false); else closeStage() }}
          />
          <div
            ref={panel}
            className={active === null ? css.panel : `${css.panel} ${css.covered}`}
            role="dialog"
            aria-modal="true"
            aria-label={t('section.title')}
          >
            <div className={css.strip} aria-hidden="true" />
            <header className={css.hero}>
              <div className={css.kicker}>
                <span className={css.kickerLeft}><PixelStar size={14} />{t('section.kicker')}</span>
                <span className={css.kickerTag}>{t('section.tag')}</span>
              </div>
              <h1 className={css.display}>{accentTitle(t('section.title'))}</h1>
              <p className={css.lede}>{t('section.lede')}</p>
              <p className={css.hint}><b>{t('section.hint')}</b></p>
            </header>
            <div className={css.grid}>
              {FEATURES.map((feature, index) => {
                const Icon = feature.icon
                return (
                  <article
                    key={feature.title}
                    ref={(el) => { cells.current[index] = el }}
                    className={css.cell}
                    tabIndex={0}
                    aria-label={t(feature.title)}
                    onClick={() => { openStage(index) }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openStage(index)
                      }
                    }}
                  >
                    <span className={css.cellTop}>
                      <span className={css.num}>{pad2(index)}</span>
                      <span className={css.chip}><Icon size={16} /></span>
                    </span>
                    <span className={css.cellTitle}>{t(feature.title)}</span>
                    <span className={css.cellDesc}>{t(feature.description)}</span>
                  </article>
                )
              })}
            </div>
            <footer className={css.foot}>
              <span><kbd>Esc</kbd> {t('footer.hint')}</span>
              <span className={css.sig}>
                <PixelStar size={12} />
                {t('section.signature', { total })}
              </span>
            </footer>
            {card !== null && active !== null && (
              <div
                ref={stage}
                className={playing ? css.stage : `${css.stage} ${css.paused}`}
                role="dialog"
                aria-modal="true"
                aria-label={t(card.title)}
              >
                <button type="button" className={css.x} aria-label={t('action.close')} onClick={closeStage}>✕</button>
                <div key={active} className={css.stageIn}>
                  <div className={css.media} style={{ '--h': String(card.hue) } as CSSProperties}>
                    <div className={css.rays} data-testid="guide-rays" aria-hidden="true">
                      {RAYS.map((ray, i) => (
                        <i
                          key={i}
                          className={css.ray}
                          style={{
                            left: `${ray.left}%`,
                            width: `${ray.width}%`,
                            opacity: ray.opacity,
                            animationDuration: `${ray.duration}s`,
                            animationDelay: `${ray.delay}s`,
                            '--drift': `${ray.drift}deg`,
                          } as CSSProperties}
                        />
                      ))}
                    </div>
                    <span className={css.surfaceGlow} aria-hidden="true" />
                    <span className={`${css.ring} ${css.r1}`} aria-hidden="true" />
                    <span className={`${css.ring} ${css.r2}`} aria-hidden="true" />
                    <span className={`${css.orb} ${css.o1}`} aria-hidden="true" />
                    <span className={`${css.orb} ${css.o2}`} aria-hidden="true" />
                    <span className={css.wm} aria-hidden="true"><MediaIcon size={140} /></span>
                    <button
                      type="button"
                      className={css.play}
                      aria-pressed={playing}
                      aria-label={t('detail.play')}
                      onClick={() => { setPlaying(value => !value) }}
                    >
                      {playing
                        ? <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5h3v14H8zM13 5h3v14h-3z" /></svg>
                        : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}><path d="M8 5.5v13l11-6.5z" /></svg>}
                    </button>
                    <span className={css.vidMeta}>{t('detail.demo')}</span>
                    <div className={css.vidProgress} aria-hidden="true"><i /></div>
                  </div>
                  <div className={css.expl}>
                    <span className={css.crumb}>{t('detail.crumb', { index: pad2(active), total })}</span>
                    <h2 className={css.dTitle}>{t(card.title)}</h2>
                    <p className={css.dDesc}>{t(card.description)}</p>
                    <div className={css.chips}>
                      {t(card.chips).split(' · ').map(keyword => <span key={keyword}>{keyword}</span>)}
                    </div>
                    <div className={css.actions}>
                      <button type="button" className={css.btn} onClick={() => { step(-1) }}>{`‹ ${t('action.prev')}`}</button>
                      <button type="button" className={css.btn} onClick={() => { step(1) }}>{`${t('action.next')} ›`}</button>
                      <span className={css.spacer} />
                      <button
                        type="button"
                        className={`${css.btn} ${css.primary}`}
                        onClick={() => { setOpen(false) }}
                      >
                        {t('action.try')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
