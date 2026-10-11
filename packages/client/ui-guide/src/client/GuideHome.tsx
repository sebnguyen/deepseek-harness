/**
 * The sidebar harness guide: a foot-style trigger that opens the capability
 * roster in a popover. The session list stays in the column; the cards do
 * not. The roster is static product copy driven off the `sidebar.guide`
 * dictionary. Wide and rail both show the trigger.
 */

import { useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { createPortal } from 'react-dom'
import {
  IconAgentPresetOutline16, IconArchiveOutline20, IconBranchOutline16, IconCodeOutline16,
  IconCordisPluginOutline14, IconGoalOutline16, IconGlobeOutline14, IconShieldOutline16,
  IconSkillOutline16, useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar shell's SlotMap merge ('sidebar.guide').
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { GuideKey } from './locales.ts'
import css from './GuideHome.module.css'

/** One capability card: glyph plus the dictionary keys of its copy. */
interface FeatureCard {
  /** The card's leading glyph, drawn on the brand tint. */
  icon: ComponentType<IconProps>
  /** Dictionary key of the card title. */
  title: GuideKey
  /** Dictionary key of the one-line description under the title. */
  description: GuideKey
}

/** The harness capability roster, in carousel order. */
const FEATURES: readonly FeatureCard[] = [
  { icon: IconShieldOutline16, title: 'guide.sandbox.title', description: 'guide.sandbox.description' },
  { icon: IconCodeOutline16, title: 'guide.shell.title', description: 'guide.shell.description' },
  { icon: IconAgentPresetOutline16, title: 'guide.delegation.title', description: 'guide.delegation.description' },
  { icon: IconBranchOutline16, title: 'guide.workflows.title', description: 'guide.workflows.description' },
  { icon: IconGoalOutline16, title: 'guide.goals.title', description: 'guide.goals.description' },
  { icon: IconSkillOutline16, title: 'guide.skills.title', description: 'guide.skills.description' },
  { icon: IconGlobeOutline14, title: 'guide.web.title', description: 'guide.web.description' },
  { icon: IconArchiveOutline20, title: 'guide.log.title', description: 'guide.log.description' },
  { icon: IconCordisPluginOutline14, title: 'guide.plugins.title', description: 'guide.plugins.description' },
]

/** The seat's composed props: the shell's column state plus its dictionary reader. */
export type GuideHomeProps = Partial<PropsRuntime<'sidebar.guide'>> & {
  /** Bound dictionary reader for the `sidebar.guide` namespace. */
  t?: (key: GuideKey, values?: Record<string, string>) => string
}

/**
 * The guide trigger and its popover. The shell supplies the stack site; the
 * seat owns the button and the roster. The session list is not part of this seat.
 * @param props - the inject face.
 */
export function GuideHome({ wide, t }: GuideHomeProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useDismissOnOutsidePointer(root, open, setOpen, panel)
  if (t === undefined) return null
  return (
    <div ref={root} className={css.root}>
      <button
        type="button"
        className={wide === true ? css.trigger : `${css.trigger} ${css.rail}`}
        aria-label={t('section.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <IconSkillOutline16 size={wide === true ? 16 : 18} />
        {wide === true && <span className={css.triggerLabel}>{t('section.title')}</span>}
      </button>
      {open && createPortal(
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={() => { setOpen(false) }} />
          <div ref={panel} className={css.panel} role="dialog" aria-modal="true" aria-label={t('section.title')}>
            <header className={css.head}>
              <span className={css.title}>{t('section.title')}</span>
              <span className={css.lede}>{t('section.lede')}</span>
            </header>
            <div className={css.strip}>
              {FEATURES.map((feature) => {
                const Icon = feature.icon
                return (
                  <article key={feature.title} className={css.card}>
                    <span className={css.cardIcon} aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <span className={css.cardText}>
                      <span className={css.cardTitle}>{t(feature.title)}</span>
                      <span className={css.cardDescription}>{t(feature.description)}</span>
                    </span>
                  </article>
                )
              })}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
