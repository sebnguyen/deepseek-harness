/**
 * The proposed chat element (pce) row chrome, shared by tool rows and chat
 * nodes: one transparent article whose head carries the kind's 16px glyph, the
 * kind and its description on one line, the elapsed/meta slot, the
 * right-aligned state, and the toggle. The body is caller-owned and rendered
 * only while expanded.
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
    | 'step-boundary' | 'inbox' | 'goal-input' | 'present'

/** Row outcome, matching the tool row's own state union. */
export type PceState = 'running' | 'ok' | 'error' | 'stopped'

/** Everything the shared pce head needs from one row. */
export interface PceRowProps {
  /** Element kind: selects the mark-colour class (`pce-<kind>`). */
  kind: PceKind
  /** Catalog glyph shown in the 16px mark cell. */
  glyph: PixelSymbolName
  /**
   * Render the row's pixel marks: the leading kind glyph and the trailing state
   * glyph or loader. False in a dense alternate shell that mounts many chats.
   */
  marks?: boolean | undefined
  /** Row title, localized by the owner. */
  title: string
  /** Description text (summary / path / first line); truncates as the row narrows. */
  summary?: string | null | undefined
  /** Elapsed/meta text in its own trailing slot (duration, window, language). */
  detail?: string | null | undefined
  /** Optional fragment after the elapsed slot, kept outside the description ellipsis (+2, +N -M). */
  suffix?: string | null | undefined
  /** Row outcome; omitted = no state cell. */
  state?: PceState | undefined
  /** Localized state label beside the state mark; omitted = mark only. */
  stateLabel?: string | null | undefined
  /** Render the summary as an openable path button. */
  onOpenSummary?: (() => void) | undefined
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
  kind, glyph, title, summary, detail, suffix, state, stateLabel, onOpenSummary,
  collapsible = true, defaultOpen = false, body, keepMounted = false, summaryData, detailData,
  summaryRole, className, headClassName, marks = true,
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
      {marks ? <span className="pce-mark" aria-hidden="true"><PixelGlyph name={glyph} size={16} /></span> : null}
      {/* The kind leads the line and the head's gap separates it from the
          description, which truncates against the row. */}
      <span className="pce-identity">{title}</span>
      {summaryText === null ? null : <span className="pce-description">{summaryNode}</span>}
      {meta === null && trailing === null
        ? null
        : (
          <span className="pce-time">
            {meta === null ? null : (
              <span data-pce-detail="" {...detailData === undefined ? {} : { [detailData]: '' }}>{meta}</span>
            )}
            {meta !== null && trailing !== null ? ' ' : null}
            {trailing}
          </span>
        )}
      {state === undefined || !marks ? null : (
        <span
          className={`pce-head-state is-${state}`}
          aria-hidden="true"
        >
          {state === 'running'
            ? <PixelLoader size={16} mode="sweep" />
            : <PixelGlyph name={state === 'ok' ? 'check' : 'close'} size={16} />}
        </span>
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
    >
      {/* The state mark is the visible signal when marks render; the localized
          state rides a visually-hidden span on the article so the toggle's
          accessible name stays the row's own identity and the state is never
          colour-only. */}
      {state === undefined || stateLabel === undefined || stateLabel === null
        ? null
        : <span className="pce-state-text">{stateLabel}</span>}
      {head}
      {expanded
        ? <div className="pce-body" key="open" data-pce-expanded={showToggle ? '' : undefined}>{content}</div>
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
