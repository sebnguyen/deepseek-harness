/**
 * The frozen Changes display of one file's snapshot lineage: a turn-axis
 * scrubber over the stops, the selected stop as one unified page against
 * its predecessor, and the stop's stated purpose with the round button
 * that quotes address plus purpose into the composer's next draft.
 *
 * The view never writes: sides are `blob` reads of the stop's recorded
 * digests, and the rows are the pure `unifiedLines` projection.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { GAP_TURN, serializeSnapshotRef, unifiedLines } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileStop } from '@deepseek-ai/dsh-client-ui-file-history/client'
import type { EditorKey } from './locales.ts'
import css from './ChangesSurface.module.css'

/**
 * The next draft with one snapshot address and, when stated, the stop's
 * purpose appended after the current text.
 * @param draft - the composer's current draft.
 * @param path - session-relative path of the stop's file.
 * @param stop - the stop the round button names.
 * @returns the replacement draft text.
 */
export function quoteInput(draft: string, path: string, stop: FileStop): string {
  const address = `@${serializeSnapshotRef({ path, turn: stop.turn ?? GAP_TURN, callId: stop.callId })}`
  const lines = stop.purpose === undefined ? [address] : [address, stop.purpose]
  const base = draft.trimEnd()
  return base === '' ? lines.join('\n') : `${base}\n${lines.join('\n')}`
}

/** Translate bound to the `editor` namespace. */
export type TranslateChanges = (key: EditorKey, params?: Record<string, string | number>) => string

/** Turn-axis positions in percent, one per stop, in stop order. */
export function placeStops(stops: readonly FileStop[]): readonly number[] {
  const xs: number[] = []
  let cursor = 0
  for (const stop of stops) {
    if (stop.turn !== undefined) cursor = stop.turn
    else cursor += 0.5
    xs.push(cursor)
  }
  const min = xs[0]
  const max = xs[xs.length - 1]
  if (min === undefined || max === undefined) return []
  return xs.map(x => (max === min ? 50 : ((x - min) / (max - min)) * 100))
}

export interface ChangesSurfaceProps {
  readonly stops: readonly FileStop[]
  readonly t: TranslateChanges
  /** One retained snapshot text; null when the object is not retained. */
  readonly blob: (digest: string, signal: AbortSignal) => Promise<string | null>
  /** Quote the stop's address and purpose into the next draft. */
  readonly onQuote: (stop: FileStop) => void
  /** Select this stop on arrival (a tab opened straight onto one stop). */
  readonly selectCallId?: string
}

/**
 * Render the Changes display for one file's stops.
 * @param props - stops, copy, the blob reader, and the quote and select callbacks.
 * @returns the scrubber, the frozen unified page, and the purpose box.
 */
export function ChangesSurface({ stops, t, blob, onQuote, selectCallId }: ChangesSurfaceProps): ReactNode {
  const [index, setIndex] = useState(() =>
    selectCallId === undefined ? stops.length - 1 : Math.max(0, stops.findIndex(stop => stop.callId === selectCallId)))
  const [frame, setFrame] = useState<{ before?: string; after?: string } | undefined>(undefined)
  const [missing, setMissing] = useState(false)
  const [ghost, setGhost] = useState<number | undefined>(undefined)
  const dragging = useRef(false)
  const stop = stops[index]

  useEffect(() => {
    const controller = new AbortController()
    setFrame(undefined)
    setMissing(false)
    if (stop === undefined) return () => controller.abort()
    const read = (digest: string | undefined) =>
      digest === undefined ? Promise.resolve<string | null>('') : blob(digest, controller.signal)
    void Promise.all([read(stop.before), read(stop.after)]).then(([before, after]) => {
      if (controller.signal.aborted) return
      if (before === null || after === null) {
        setMissing(true)
        return
      }
      setFrame({
        ...before === '' ? {} : { before },
        ...after === '' ? {} : { after },
      })
    })
    return () => controller.abort()
  }, [stop, blob])

  // A late navigation onto one stop re-selects it once the rolls carry it.
  useEffect(() => {
    if (selectCallId === undefined) return
    const next = stops.findIndex(stop => stop.callId === selectCallId)
    if (next >= 0) setIndex(next)
  }, [selectCallId, stops])

  const xs = useMemo(() => placeStops(stops), [stops])
  const lines = useMemo(() => (frame === undefined ? [] : unifiedLines(frame.before, frame.after)), [frame])

  const fracOf = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    return rect.width === 0 ? 0 : Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  }
  const nearest = (frac: number): number => {
    const target = frac * 100
    let best = 0
    let distance = Number.POSITIVE_INFINITY
    for (const [i, x] of xs.entries()) {
      const d = Math.abs(x - target)
      if (d < distance) {
        distance = d
        best = i
      }
    }
    return best
  }

  const firstTurn = stops.find(s => s.turn !== undefined)?.turn
  const lastTurn = [...stops].reverse().find(s => s.turn !== undefined)?.turn

  if (stop === undefined) {
    return <div className={css.root} data-changes=""><div className={css.missing}>{t('changes.empty')}</div></div>
  }
  return (
    <div className={css.root} data-changes="">
      <div className={css.strip}>
        <span className={css.edge}>{firstTurn === undefined ? '' : t('turnN', { n: firstTurn })}</span>
        <div
          className={css.track}
          onPointerDown={(event) => {
            dragging.current = true
            // jsdom lacks pointer capture; the move/up handlers still track it.
            event.currentTarget.setPointerCapture?.(event.pointerId)
            setGhost(fracOf(event) * 100)
          }}
          onPointerMove={(event) => {
            if (dragging.current) setGhost(fracOf(event) * 100)
          }}
          onPointerUp={(event) => {
            if (!dragging.current) return
            dragging.current = false
            setGhost(undefined)
            setIndex(nearest(fracOf(event)))
          }}
        >
          <span className={css.line} />
          {stops.map((s, i) => (
            <button
              key={s.callId}
              type="button"
              className={i === index ? `${css.tick} ${css.tickOn}` : css.tick}
              style={{ left: `${xs[i]}%` }}
              title={s.turn === undefined ? t('gapMeta') : `${t('turnN', { n: s.turn })} · ${s.toolName}`}
              onClick={() => { setIndex(i) }}
            >
              {i === index
                ? <span className={css.playh} />
                : s.turn === undefined ? <span className={css.diamond} /> : null}
            </button>
          ))}
          {ghost === undefined ? null : <span className={css.ghost} style={{ left: `${ghost}%` }} />}
        </div>
        <span className={css.edge}>{lastTurn === undefined ? '' : t('turnN', { n: lastTurn })}</span>
      </div>
      {missing
        ? <div className={css.missing}>{t('missingBlob')}</div>
        : (
          <pre className={css.diff}>
            {lines.map((line, i) => (
              <span
                key={i}
                className={line.kind === 'added' ? `${css.ln} ${css.add}` : line.kind === 'removed' ? `${css.ln} ${css.del}` : css.ln}
              >
                <i className={css.gn}>{line.oldLine ?? ''}</i>
                <i className={css.gn}>{line.newLine ?? ''}</i>
                <s className={line.kind === 'added' ? css.sAdd : line.kind === 'removed' ? css.sDel : css.sCtx}>
                  {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                </s>
                <code>{line.text}</code>
              </span>
            ))}
          </pre>
        )}
      <div className={css.prow}>
        <button type="button" className={css.addb} aria-label={t('addNext')} onClick={() => { onQuote(stop) }}>＋</button>
        <div className={css.pbox}>
          <span className={css.r1}>
            <b className={css.ttl}>{t('purpose')}</b>
            <span className={css.meta}>
              {stop.turn === undefined
                ? t('gapMeta')
                : t('meta', { turn: stop.turn, tool: stop.toolName, call: stop.callId })}
            </span>
          </span>
          <p>{stop.purpose ?? t('noPurpose')}</p>
        </div>
      </div>
    </div>
  )
}
