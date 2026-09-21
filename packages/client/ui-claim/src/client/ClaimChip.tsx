/**
 * Claim status surfaces: the action-row chips and the composer dock strip.
 * Each chip is a toggle — clicking opens a small card with three accordions
 * (title, description, raw verifier script) instead of a text blob. The
 * action row lists every claim the owning turn declared, pending or settled,
 * so a passed or failed claim stays viewable after its turn finishes. The
 * dock above the composer shows a compact line of the pending claims while
 * the session runs. Durable state arrives through the `claim` Session
 * projection; this plugin only reads it and has no actions.
 * @module @deepseek-ai/dsh-client-ui-claim/client/ClaimChip
 */

import { useState, type ReactNode } from 'react'
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
  pending: { label: 'chip.pending', dot: 'idle' },
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

/** Shared inner chip: a toggle button, labeled with the claim title and a status dot, opening the details under it. */
function Chip({ claim, t, className }: {
  claim: Claim
  t: TranslateNS<'claim'>
  /** The CSS-module class may be absent from a pruned build output. */
  className: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const present = CHIP_PRESENTATION[claim.settlement.kind]
  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={className}
        data-state={claim.settlement.kind}
        aria-expanded={open}
        aria-label={t(present.label)}
        title={t(present.label)}
        onClick={() => { setOpen(!open) }}
      >
        <StateDot state={present.dot} />
        <span className={css.label}>{claim.title}</span>
      </button>
      {open && <ClaimDetails claim={claim} t={t} />}
    </span>
  )
}

/**
 * One claim's status chip.
 * @param props - the claim and the localized copy.
 * @returns the chip, or null for a turn without a claim.
 */
export function ClaimChip({ claim, t }: {
  claim: Claim | undefined
  t: TranslateNS<'claim'>
}) {
  if (claim === undefined) return null
  return <Chip claim={claim} t={t} className={css.chip} />
}

/** Full props of the action-row entry: AssistantAction owner share + the locale seat. */
export type ClaimActionProps =
  import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.chat.assistant-actions'>
  & import('@deepseek-ai/dsh-client-ui-slots').PropsLocale<'claim'>

/**
 * Action-row adapter: lists every claim the owning turn declared, in
 * declaration order, pending or settled. A turn that declared no claim
 * renders nothing.
 * @param props - the action-row owner share (message id and owning Turn) and the locale seat.
 * @returns the chips for this turn's claims, or nothing.
 */
export function ClaimAction({ turn, useProjection, t }: ClaimActionProps) {
  const claims = useProjection('claim', all => all?.filter(entry => entry.turn === turn.turn))
  if (claims === undefined || claims.length === 0) return null
  return (
    <>
      {claims.map(claim => <Chip key={claim.id} claim={claim} t={t} className={css.chip} />)}
    </>
  )
}

/** Full props of the dock entry: InputZone owner share + the locale seat. */
export type ClaimDockProps =
  import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'>
  & import('@deepseek-ai/dsh-client-ui-slots').PropsLocale<'claim'>

/**
 * Dock adapter: a "Claims" row above the composer listing the latest turn's
 * claims, each as a status chip — green when passed, red when blocked or
 * tampered, and a fading grey while its verifier has not run.
 * @param props - the dock runtime share and the locale seat.
 * @returns the dock strip for the latest turn's claims, or nothing.
 */
export function ClaimDock({ useProjection, t }: ClaimDockProps) {
  const claims = useProjection('claim')
  const latest = claims?.at(-1)?.turn
  const chips = latest === undefined ? [] : (claims ?? []).filter(claim => claim.turn === latest)
  if (chips.length === 0) return null
  return (
    <div className={css.dock} data-claim-dock>
      <div className={css.bar}>
        <div className={css.barHead}>
          <span className={css.dockLabel}>{t('dock.label')}</span>
          {chips.map(claim => <DockChip key={claim.id} claim={claim} />)}
        </div>
      </div>
    </div>
  )
}

/** One non-interactive status chip: the claim title plus a settlement-colored dot. */
function DockChip({ claim }: { claim: Claim }) {
  const present = CHIP_PRESENTATION[claim.settlement.kind]
  return (
    <span className={css.dockChip} data-state={claim.settlement.kind}>
      <StateDot state={present.dot} />
      <span className={css.dockChipTitle}>{claim.title}</span>
    </span>
  )
}
