/**
 * The proposed chat element (pce) row chrome, shared by tool rows and chat
 * nodes: one transparent article whose head carries the kind's catalog glyph,
 * an 11px/650 identity with a mono meta line, the right-aligned state, and the
 * 14px toggle. The body is caller-owned and rendered only while expanded.
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { PixelLoader } from '../PixelLoader.tsx'
import { PixelGlyph } from '../PixelGlyph.tsx'
import type { PixelSymbolName } from '../pixel-symbols/symbols.ts'
import './PceRow.css'

/** The node kinds the pce design covers. */
export type PceKind
  = | 'user' | 'assistant' | 'steering' | 'context' | 'system-prompt' | 'reasoning'
    | 'tool-generic' | 'read' | 'file-mutation' | 'bash' | 'search' | 'web' | 'todo' | 'ask'
    | 'read-image' | 'subcalls' | 'workflow-run' | 'command' | 'manual-compaction'
    | 'compaction' | 'retry' | 'turn-error' | 'max-tokens' | 'turn-tail' | 'unknown'
    | 'step-boundary' | 'inbox' | 'goal-input'

/** Row outcome, matching the tool row's own state union. */
export type PceState = 'running' | 'ok' | 'error' | 'stopped'

/** An action riding the identity meta line (Inspect / Open). */
export interface PceAction {
  /** Localized action label. */
  label: string
  /** Invoked after the head's click is stopped. */
  onClick: () => void
  /** `open` selects the explorer-reveal icon; otherwise Inspect remains textual. */
  kind?: 'open' | undefined
}

/** Everything the shared pce head needs from one row. */
export interface PceRowProps {
  /** Element kind: selects the mark-colour class (`pce-<kind>`). */
  kind: PceKind
  /** Catalog glyph shown in the 20px mark cell. */
  glyph: PixelSymbolName
  /** Row title, localized by the owner. */
  title: string
  /** Identity meta line's leading text (summary / path / first line). */
  summary?: string | null | undefined
  /** Identity meta tail (duration, window, language). */
  detail?: string | null | undefined
  /** Optional trailing fragment kept outside the meta ellipsis (+2, +N -M). */
  suffix?: string | null | undefined
  /** Row outcome; omitted = no state cell. */
  state?: PceState | undefined
  /** Localized state label beside the state mark; omitted = mark only. */
  stateLabel?: string | null | undefined
  /** Render the summary as an openable path button. */
  onOpenSummary?: (() => void) | undefined
  /** Inspect/Open action in the meta line. */
  action?: PceAction | null | undefined
  /** Collapsible head; false = always-open body and no toggle. */
  collapsible?: boolean | undefined
  /** Start expanded; ignored when not collapsible. */
  defaultOpen?: boolean | undefined
  /** Expanded body; a function runs only while expanded. Null hides the toggle. */
  body: ReactNode | (() => ReactNode) | null
  /** Keep the body mounted with `hidden="until-found"` while collapsed. */
  keepMounted?: boolean | undefined
  /** `data-*` attribute attached to the summary span (legacy/test hooks). */
  summaryData?: string | undefined
  /** `data-*` attribute attached to the detail span (legacy/test hooks). */
  detailData?: string | undefined
  /** Optional ARIA role for the summary span (e.g. `status`). */
  summaryRole?: 'status' | undefined
  /** Extra class composed onto the article (chat-node spacing). */
  className?: string | undefined
  /** Extra class composed onto the head. */
  headClassName?: string | undefined
}

/**
 * Render one proposed chat element row.
 * @param props - row identity, glyph, state, and expanded body.
 * @returns the pce article.
 */
export function PceRow({
  kind, glyph, title, summary, detail, suffix, state, stateLabel, onOpenSummary, action,
  collapsible = true, defaultOpen = false, body, keepMounted = false, summaryData, detailData,
  summaryRole, className, headClassName,
}: PceRowProps) {
  const [open, setOpen] = useState(collapsible ? defaultOpen : true)
  const expandable = body !== null
  const showToggle = collapsible && expandable
  const expanded = expandable && open
  const content = expanded
    ? (typeof body === 'function' ? body() : body)
    : null
  const toggle = () => {
    if (showToggle) setOpen(value => !value)
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!showToggle) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggle()
  }
  const meta = detail === undefined || detail === null || detail === '' ? null : detail
  const summaryText = summary === undefined || summary === null || summary === '' ? null : summary
  const trailing = suffix === undefined || suffix === null || suffix === '' ? null : suffix
  // The summary is the row's description: it may be an openable path.
  const summaryNode = summaryText === null
    ? null
    : onOpenSummary === undefined
      ? (
        <span
          data-pce-summary=""
          role={summaryRole}
          {...summaryData === undefined ? {} : { [summaryData]: '' }}
        >
          {summaryText}
        </span>
      )
      : (
        <button
          type="button"
          className="pce-path"
          data-file-link=""
          onClick={(event) => {
            event.stopPropagation()
            onOpenSummary()
          }}
          onKeyDown={(event) => { event.stopPropagation() }}
        >
          {summaryText}
        </button>
      )
  const head = (
    <div
      className={`pce-head${showToggle ? ' is-collapsible' : ''}${headClassName === undefined ? '' : ` ${headClassName}`}`}
      data-sample={kind}
      data-state={state}
      data-expandable={showToggle ? '' : undefined}
      role={showToggle ? 'button' : undefined}
      tabIndex={showToggle ? 0 : undefined}
      aria-expanded={showToggle ? expanded : undefined}
      onClick={showToggle ? toggle : undefined}
      onKeyDown={showToggle ? toggleFromKeyboard : undefined}
    >
      <span className="pce-mark" aria-hidden="true"><PixelGlyph name={glyph} size={24} /></span>
      <span className="pce-identity">
        {/* DOM keeps the kind first so the head's accessible name stays
            "kind · description"; the stylesheet reverses the visual order so
            the description leads and the kind sits under it, quiet. */}
        {summaryText === null ? null : <span className="pce-identity-title">{title}</span>}
        <strong>
          {summaryNode ?? title}
          {summaryText !== null && meta !== null ? ' · ' : null}
          {meta === null ? null : (
            <span data-pce-detail="" {...detailData === undefined ? {} : { [detailData]: '' }}>{meta}</span>
          )}
        </strong>
      </span>
      {trailing === null ? null : <span className="pce-identity-suffix">{trailing}</span>}
      {state === undefined ? null : (
        <span
          className={`pce-head-state is-${state}`}
          aria-hidden="true"
        >
          {state === 'running'
            ? <PixelLoader size={16} mode="sweep" />
            : <PixelGlyph name={state === 'ok' ? 'check' : 'close'} size={16} />}
        </span>
      )}
      {action === undefined || action === null ? null : (
        <button
          type="button"
          className="pce-action"
          data-inspect-kind={action.kind ?? 'inspect'}
          onClick={(event) => {
            event.stopPropagation()
            action.onClick()
          }}
          onKeyDown={(event) => { event.stopPropagation() }}
        >
          {action.label}
        </button>
      )}
      {showToggle ? <span className="pce-toggle" aria-hidden="true">{expanded ? '▾' : '▸'}</span> : null}
    </div>
  )
  return (
    <article
      className={`pce pce-${kind} pce-tone-${state ?? 'ok'}${className === undefined ? '' : ` ${className}`}`}
      data-pce={kind}
      data-variant={kind}
      data-state={state}
      aria-label={`${title} redesigned chat element`}
    >
      {/* The mark is the visible signal; the localized state rides a
          visually-hidden span on the article so the toggle's accessible name
          stays the row's own identity and the state is never colour-only. */}
      {state === undefined || stateLabel === undefined || stateLabel === null
        ? null
        : <span className="pce-state-text">{stateLabel}</span>}
      {head}
      {expanded
        ? <div className="pce-body" key="open">{content}</div>
        : keepMounted && expandable
          ? (
            <div
              className="pce-body"
              key="hidden"
              ref={(element) => { element?.setAttribute('hidden', 'until-found') }}
            >
              {typeof body === 'function' ? null : body}
            </div>
          )
          : null}
    </article>
  )
}
