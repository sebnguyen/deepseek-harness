/**
 * Context Window view: the latest settled request's composition, sized by
 * heuristic token estimate and colored by real KV-cache hit/miss. Shows the
 * current request only — the underlying `contextComposition` projection and
 * `deriveTurnTokenUsage` fold are both replay-safe for any past Turn, so
 * browsing history is a follow-up, not a redesign.
 *
 * The row/split-pane visual language mirrors `ui-trajectory`'s live-rendered
 * ledger (`TrajectoryTable.tsx`/`.module.css`): a flat, 30px, two-column row
 * list plus a selection-driven `.details` side panel — not
 * `TrajectoryCell.tsx`, whose own source comment marks it "Legacy standalone
 * … retained for direct consumers and specs," i.e. not what a user actually
 * sees in the live Trajectory tab. `ui-trajectory` exports no React
 * components across the plugin boundary (client bundle purity forbids
 * cross-plugin value imports), only types, so matching its look means
 * re-deriving the CSS, not importing its component. The timeline strip does
 * reuse a live component's CSS, `TrajectoryTimeline.module.css`, unchanged.
 *
 * The hit/miss/partial cache signal — the reason this tab exists — has no
 * Trajectory equivalent: it's a full row/span background tint, plus (once a
 * row is selected and its background switches to the neutral "active" tint)
 * a persistent left rail in the same color, reusing Trajectory's own
 * `.selectionRail` idiom so the classification doesn't disappear on select.
 *
 * `contentBySeq` only covers seqs the browser's own conversation engine has
 * locally replayed — bounded by the session controller's page window
 * (`DEFAULT_MAX_MESSAGES` in `history.ts`), unlike `contextComposition`,
 * which folds the complete durable log server-side regardless of what the
 * client has fetched. A composition segment older than the loaded window is
 * therefore a real gap, not empty content; `loadThrough` (the same jump
 * loader Trajectory's inspect-a-call navigation uses) backfills it.
 *
 * The root element's `data-conversation-composer-overlay` attribute isn't
 * decorative: `ConversationRoot.module.css`'s `.scrollBody:has([data-
 * conversation-composer-overlay])` selector is what switches the hosting
 * `.viewArea` from Chat's default *unbounded* mode (grows to content height;
 * the page itself scrolls) into the *bounded* mode a tab needs to own an
 * internal, independently scrolling body — the same attribute
 * `TrajectoryView.tsx` sets on its own root. Without it, every `height:100%`
 * / `flex:1;min-height:0` rule in this file's CSS module has nothing
 * definite to resolve against, and `.split`'s sticky `.details` panel drifts
 * with the whole page instead of pinning inside its own scrollport.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { classifyComposition, cacheHitPercent, totalHeuristicTokens } from './timeline.ts'
import type { ContextWindowSegment } from './timeline.ts'
import css from './ContextWindowView.module.css'

/** Session-bound control not already supplied by the conversation view slot. */
export interface ContextWindowViewInjected {
  /** Page history backwards until the window covers `seq` (the jump loader `ISession.loadThrough` wraps). */
  loadThrough: (seq: number) => Promise<void>
}

/** Style object augmented with the span/row custom properties the CSS module reads. */
type SegmentStyle = CSSProperties & { '--segment-left'?: string; '--segment-width'?: string; '--hit-fraction'?: number }

/**
 * Tag pill class per role, matching TrajectoryTable's live
 * systemNeutral/user/assistantVioletBright/toolAmber scheme. `'tools'` (the synthetic tool-schema
 * node) shares `tool`'s amber — both are tool-calling machinery, disambiguated by their distinct
 * labels.
 */
const TAG_CLASS: Record<ContextWindowSegment['role'], string | undefined> = {
  system: css.tagSystem,
  user: css.tagUser,
  assistant: css.tagAssistant,
  tool: css.tagTool,
  tools: css.tagTool,
}

/** Join CSS module classes, dropping any that resolved to `undefined`. */
function cx(...classes: (string | undefined | false)[]): string {
  return classes.filter((c): c is string => c !== undefined && c !== false).join(' ')
}

/** Format a token count with thousands separators. */
function formatTokens(value: number): string {
  return value.toLocaleString()
}

/** Collapse a multi-line content preview to a single line for the row's ellipsized text slot. */
function inlinePreview(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}

/** A content lookup result: `undefined` means not loaded client-side yet, distinct from a genuinely empty `''`. */
function contentLabel(content: string | undefined, t: PropsLocale<'contextWindow'>['t']): string {
  if (content === undefined) return t('content.notLoaded')
  return content === '' ? t('content.empty') : inlinePreview(content)
}

export function ContextWindowView({
  useContextWindow, useProjection, loadThrough, t,
}: ConvViewProps & InjectFace<ContextWindowViewInjected> & PropsLocale<'contextWindow'>) {
  const { latest, newestTurn, contentBySeq } = useContextWindow(snapshot => snapshot)
  const composition = useProjection('contextComposition')
  const pressure = useProjection('contextPressure')
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)

  // contentBySeq only covers seqs the browser has locally replayed, bounded
  // by the session controller's initial page window; contextComposition
  // folds the complete durable log server-side. Backfill through the
  // earliest referenced seq once, whenever it isn't covered yet — loadThrough
  // itself no-ops once the window already covers it or history is exhausted.
  useEffect(() => {
    if (composition === undefined || composition.length === 0) return
    const minSeq = Math.min(...composition.map(node => node.seq))
    if (contentBySeq.has(minSeq)) return
    void loadThrough(minSeq)
  }, [composition, contentBySeq, loadThrough])

  if (latest?.usage === undefined) {
    return <div className={css.root} data-conversation-composer-overlay=""><div className={css.empty}>{t('empty.noRequest')}</div></div>
  }
  if (composition === undefined || composition.length === 0) {
    return <div className={css.root} data-conversation-composer-overlay=""><div className={css.empty}>{t('empty.noComposition')}</div></div>
  }

  const { usage } = latest
  const segments = classifyComposition(composition, usage.cacheReadTokens)
  const total = totalHeuristicTokens(composition)
  const hitPercent = cacheHitPercent(usage.cacheReadTokens, usage.totalTokens, usage.outputTokens)
  // deriveTurnTokenUsage only discloses usage once its Turn reaches turn/end;
  // an open or aborted-mid-step newest Turn falls back to the last one that
  // settled, so newestTurn can be ahead of what's actually shown here.
  const pending = newestTurn !== undefined && newestTurn !== latest.turn
  const cacheUnknown = usage.cacheReadTokens === undefined
  const selected = segments.find(segment => segment.seq === selectedSeq)

  let cursor = 0

  return (
    <div className={css.root} data-conversation-composer-overlay="">
      <div className={css.header}>
        <span className={css.headerTurn}>{t('header.turn', { turn: String(latest.turn) })}</span>
        <span>{t('header.usage', {
          used: formatTokens(total),
          capacity: pressure?.contextWindow === undefined ? '?' : formatTokens(pressure.contextWindow),
        })}</span>
        {hitPercent !== undefined && (
          <span className={css.headerCache}>{t('header.cacheHit', { percent: String(hitPercent) })}</span>
        )}
      </div>
      {pending && newestTurn !== undefined && (
        <div className={css.headerCache}>
          {t('header.turnPending', { newestTurn: String(newestTurn), shownTurn: String(latest.turn) })}
        </div>
      )}
      {cacheUnknown && (
        <div className={css.headerCache}>{t('header.cacheUnknown')}</div>
      )}

      <div className={css.plot}>
        <div className={css.plotLabel} />
        <div className={css.track}>
          {segments.map((segment) => {
            const left = total === 0 ? 0 : cursor / total * 100
            cursor += segment.heuristicTokens
            const spanStyle: SegmentStyle = {
              '--segment-left': `${left}%`,
              '--segment-width': `${total === 0 ? 0 : segment.heuristicTokens / total * 100}%`,
              ...(segment.cacheClass === 'partial' ? { '--hit-fraction': segment.hitFraction } : {}),
            }
            return (
              <button
                key={segment.seq}
                type="button"
                className={cx(css.span, css[segment.cacheClass], selectedSeq === segment.seq && css.spanSelected)}
                style={spanStyle}
                title={`${t(`role.${segment.role}`)} — ${formatTokens(segment.heuristicTokens)} tokens — ${t(`segment.${segment.cacheClass}`)}`}
                onClick={() => { setSelectedSeq(segment.seq) }}
              />
            )
          })}
        </div>
      </div>

      <div className={css.split}>
        <div className={css.list}>
          {segments.map((segment) => {
            const rowSelected = selectedSeq === segment.seq
            const rowStyle: SegmentStyle | undefined = segment.cacheClass === 'partial'
              ? { '--hit-fraction': segment.hitFraction }
              : undefined
            const label = contentLabel(contentBySeq.get(segment.seq), t)
            return (
              <button
                key={segment.seq}
                type="button"
                className={cx(css.row, css[segment.cacheClass], rowSelected && css.rowSelected)}
                style={rowStyle}
                aria-selected={rowSelected}
                onClick={() => { setSelectedSeq(segment.seq) }}
              >
                {rowSelected && <span className={cx(css.cacheRail, css[segment.cacheClass])} aria-hidden="true" />}
                <span className={css.kindSlot}>
                  <span className={cx(css.kindTag, TAG_CLASS[segment.role])}>{t(`role.${segment.role}`)}</span>
                </span>
                <span className={css.content}>
                  <span className={css.contentText} title={label}>{label}</span>
                </span>
                <span className={css.tokens}>{formatTokens(segment.heuristicTokens)}</span>
              </button>
            )
          })}
        </div>

        {selected !== undefined && (
          <aside className={css.details}>
            <div className={css.detailsHeader}>
              <span className={css.detailsTitle}>
                <span className={cx(css.kindTag, TAG_CLASS[selected.role])}>{t(`role.${selected.role}`)}</span>
              </span>
              <button type="button" className={css.close} aria-label={t('detail.close')} onClick={() => { setSelectedSeq(null) }}>
                ×
              </button>
            </div>
            <div className={css.detailBody}>
              <dl className={css.detailMeta}>
                <div><dt>{t('detail.role')}</dt><dd>{t(`role.${selected.role}`)}</dd></div>
                <div><dt>{t('detail.tokens')}</dt><dd>{formatTokens(selected.heuristicTokens)}</dd></div>
                <div><dt>{t('detail.cacheClass')}</dt><dd>{t(`segment.${selected.cacheClass}`)}</dd></div>
              </dl>
              {(() => {
                const content = contentBySeq.get(selected.seq)
                return content === undefined || content === ''
                  ? <p className={css.noPayload}>{content === undefined ? t('content.notLoaded') : t('content.empty')}</p>
                  : <pre className={css.detailContent}>{content}</pre>
              })()}
            </div>
          </aside>
        )}
      </div>

      <div className={css.disclaimer}>{t('disclaimer')}</div>
    </div>
  )
}
