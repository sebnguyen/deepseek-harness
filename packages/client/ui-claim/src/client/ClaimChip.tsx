/**
 * Claim status surfaces: the action-row chip and the composer dock strip.
 * Both are toggles — clicking opens a small card with three accordions
 * (purpose, satisfy condition, raw verifier script) instead of a text blob.
 * While the session's claim is pending, the dock strip above the composer
 * shows it and the action row carries its chip on every turn; once no claim
 * is pending, the action-row chip is gone. Durable state arrives through
 * the `claim` Session projection; this plugin only reads it and has no
 * actions.
 * @module @deepseek-ai/dsh-client-ui-claim/client/ClaimChip
 */

import { useState, type ReactNode } from 'react'
import type { Claim } from '@deepseek-ai/dsh-claim/client'
import { IconChevronDownOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClaimKey } from './locales.ts'
import css from './ClaimChip.module.css'

/** Chip label key and dot state per settlement kind. */
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

/** The expanded card: three accordions (purpose, satisfy, raw script) plus the run/block status lines. */
function ClaimDetails({ claim, t }: {
  claim: Claim
  t: TranslateNS<'claim'>
}) {
  const last = claim.results.at(-1)
  return (
    <div className={css.panel}>
      <Accordion title={t('detail.purpose')}>
        <p className={css.prose}>{claim.purpose}</p>
      </Accordion>
      <Accordion title={t('detail.satisfy')}>
        <p className={css.prose}>{claim.satisfy}</p>
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

/** Shared inner chip: a toggle button opening the claim details under it. */
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
        onClick={() => { setOpen(!open) }}
      >
        <StateDot state={present.dot} />
        <span className={css.label}>{t(present.label)}</span>
      </button>
      {open && <ClaimDetails claim={claim} t={t} />}
    </span>
  )
}

/**
 * The turn's claim status chip.
 * @param props - the turn's claim and the localized copy.
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
 * Action-row adapter: picks the session's current pending claim out of the
 * projection ledger, regardless of which turn declared it.
 * @param props - the action-row owner share (message id and owning Turn) and the locale seat.
 * @returns the chip for the pending claim, or nothing.
 */
export function ClaimAction({ useProjection, t }: ClaimActionProps) {
  const claim = useProjection('claim', claims => claims?.find(entry => entry.settlement.kind === 'pending'))
  if (claim === undefined) return null
  return <Chip claim={claim} t={t} className={css.chip} />
}

/** Full props of the dock entry: InputZone owner share + the locale seat. */
export type ClaimDockProps =
  import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.input.dock'>
  & import('@deepseek-ai/dsh-client-ui-slots').PropsLocale<'claim'>

/**
 * Dock adapter: renders the session's open claim as a strip above the
 * composer while the Session is running. A claim left pending by a dead
 * session's interrupted turn stays hidden here — the strip is a
 * live-work affordance, and the action-row chip still reports the
 * un-settled state.
 * @param props - the dock runtime share and the locale seat.
 * @returns the dock strip for the open claim, or nothing.
 */
export function ClaimDock({ useSession, useProjection, t }: ClaimDockProps) {
  const running = useSession(snapshot => snapshot.running)
  const claims = useProjection('claim')
  const pending = running
    ? claims?.filter(claim => claim.settlement.kind === 'pending').at(-1)
    : undefined
  if (pending === undefined) return null
  return (
    <div className={css.dock} data-claim-dock="pending">
      <div className={css.bar}>
        <div className={css.barHead}>
          <StateDot state="ongoing" />
          <span className={css.dockLabel}>{t('chip.pending')}</span>
          <span className={css.purpose}>{pending.purpose}</span>
        </div>
        <ClaimDetails claim={pending} t={t} />
      </div>
    </div>
  )
}
