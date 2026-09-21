/**
 * Claim status surface: the composer's Claims accessory. The composer's
 * accessory row carries a compact Claims trigger — an aggregate status dot
 * (red failed, blue pending, green passed) that opens a dropdown menu of the
 * latest turn's claims. Each chip is a toggle — clicking opens a small card
 * with three accordions (title, description, raw verifier script) instead of a
 * text blob. Durable state arrives through the `claim` Session projection;
 * this plugin only reads it and has no actions.
 * @module @deepseek-ai/dsh-client-ui-claim/client/ClaimChip
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Claim } from '@deepseek-ai/dsh-claim/client'
import { IconChevronDownOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClaimKey } from './locales.ts'
import css from './ClaimChip.module.css'

/** Chip status label key and dot state per settlement kind. */
const CHIP_PRESENTATION: Record<Claim['settlement']['kind'], {
  label: ClaimKey
  dot: StateDotState
}> = {
  pending: { label: 'chip.pending', dot: 'ongoing' },
  passed: { label: 'chip.passed', dot: 'done' },
  tampered: { label: 'chip.tampered', dot: 'error' },
  blocked: { label: 'chip.blocked', dot: 'error' },
}

/** Verifier-outcome label keys, one per `VerifierOutcome` plus the no-run case. */
const VERIFIER_LABELS = {
  pass: 'verifier.pass',
  fail: 'verifier.fail',
  inconclusive: 'verifier.inconclusive',
  tampered: 'verifier.tampered',
  none: 'verifier.none',
} as const satisfies Record<string, ClaimKey>

/** One self-managed accordion row inside the detail panel: open by default, collapsible. */
function Accordion({ title, children }: {
  title: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className={css.section} data-open={open || undefined}>
      <button
        type="button"
        className={css.sectionHead}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <IconChevronDownOutline14 className={css.chevron} />
        <span className={css.sectionTitle}>{title}</span>
      </button>
      {open && <div className={css.sectionBody}>{children}</div>}
    </div>
  )
}

/** The expanded card: three accordions (title, description, raw script) plus the run/block status lines. */
function ClaimDetails({ claim, t }: {
  claim: Claim
  t: TranslateNS<'claim'>
}) {
  const last = claim.results.at(-1)
  return (
    <div className={css.panel}>
      <Accordion title={t('detail.title')}>
        <p className={css.prose}>{claim.title}</p>
      </Accordion>
      <Accordion title={t('detail.description')}>
        <p className={css.prose}>{claim.description}</p>
      </Accordion>
      <Accordion title={t('detail.script')}>
        <pre className={css.script}><code>{claim.verifier.source}</code></pre>
      </Accordion>
      {last !== undefined && (
        <div className={css.statusLine}>{t('detail.lastRun')}: {t(VERIFIER_LABELS[last.outcome])}</div>
      )}
      {claim.settlement.kind === 'blocked' && (
        <div className={css.statusLineError}>
          {t('detail.blocked')}: {claim.settlement.message}
        </div>
      )}
    </div>
  )
}

/** Full props of the composer-seat entry: input.right runtime share + the locale seat. */
export type ClaimDockProps =
  import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.right'>
  & import('@deepseek-ai/dsh-client-ui-slots').PropsLocale<'claim'>

/** Unplaced portal card: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real. */
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/**
 * The trigger's aggregate dot: any failed claim is red, else any pending
 * claim is blue, else every claim passed is green.
 */
function aggregateDot(chips: readonly Claim[]): StateDotState {
  if (chips.some(claim => claim.settlement.kind === 'blocked' || claim.settlement.kind === 'tampered')) return 'error'
  if (chips.some(claim => claim.settlement.kind === 'pending')) return 'ongoing'
  return 'done'
}

/**
 * Composer-seat adapter: a compact Claims trigger among the composer's
 * accessory controls — an aggregate status dot plus the label — opening a
 * dropdown menu of the latest turn's claims, each row expanding its details.
 * @param props - the composer-seat runtime share and the locale seat.
 * @returns the Claims trigger, or nothing while no claim exists.
 */
export function ClaimDock({ useProjection, t }: ClaimDockProps) {
  const claims = useProjection('claim')
  const latest = claims?.at(-1)?.turn
  const chips = latest === undefined ? [] : (claims ?? []).filter(claim => claim.turn === latest)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<CSSProperties | null>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      // The portaled card is outside the trigger subtree; check both.
      if (rootRef.current?.contains(event.target as Node) === true) return
      if (menuRef.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  // Portaled placement (the composer menu family's rules: fixed from the
  // anchor rect, measured before paint, clamped inside the viewport) above
  // the trigger, right edges aligned.
  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return }
    const place = (): void => {
      /* v8 ignore next 2 -- the trigger ref is attached whenever the menu is open. */
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const MARGIN = 12
      const lw = menuRef.current?.offsetWidth ?? 0
      const lh = menuRef.current?.offsetHeight ?? 0
      let x = rect.right - lw
      let y = rect.top - 8 - lh
      if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN)
      if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN)
      setMenuPos({ left: x, top: y })
    }
    // First run measures the hidden pre-render (same commit as `open`), so
    // the card lands placed before anything paints.
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, chips.length])

  if (chips.length === 0) return null

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      setOpen(false)
      queueMicrotask(() => { triggerRef.current?.focus() })
    }
  }

  return (
    <div ref={rootRef} className={css.dockRoot} data-open={open || undefined} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={t('dock.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <StateDot state={aggregateDot(chips)} />
        <span className={css.triggerLabel}>{t('dock.label')}</span>
        <IconChevronDownOutline14 className={css.chevron} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className={css.menu} style={menuPos ?? MEASURE_STYLE} role="menu" aria-label={t('dock.label')}>
          {chips.map(claim => <ClaimRow key={claim.id} claim={claim} t={t} />)}
        </div>,
        document.body,
      )}
    </div>
  )
}

/** One accordion row: dot + title + status, expanding the claim details on click. */
function ClaimRow({ claim, t }: {
  claim: Claim
  t: TranslateNS<'claim'>
}) {
  const [open, setOpen] = useState(false)
  const present = CHIP_PRESENTATION[claim.settlement.kind]
  return (
    <div className={css.menuItem} data-state={claim.settlement.kind} data-open={open || undefined}>
      <button
        type="button"
        className={css.menuRow}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <StateDot state={present.dot} />
        <span className={css.menuRowTitle}>{claim.title}</span>
        <span className={css.menuRowStatus}>{t(present.label)}</span>
        <IconChevronDownOutline14 className={css.chevron} />
      </button>
      {open && <ClaimDetails claim={claim} t={t} />}
    </div>
  )
}
