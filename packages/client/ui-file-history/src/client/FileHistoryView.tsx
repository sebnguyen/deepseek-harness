/** File-history view: a per-file snapshot timeline with a diff and purpose per stop. */

import { useEffect, useMemo, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { DiffBlock, type DiffHunk } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { groupStopsByTurn, type FileHistorySnapshot, type FileStop } from './fold.ts'
import { NS } from './locales.ts'
import css from './views.module.css'

/** Timeline actions the owning plugin injects into the view. */
export interface FileHistoryViewInjected {
  /**
   * Write a captured stop's bytes back through the Host fs capability.
   * @param path - session-relative path to restore.
   * @param digest - digest recorded on the stop being restored.
   * @returns the restored path.
   */
  restore(path: string, digest: string): Promise<string>
  /**
   * Read one retained stop's text.
   * @param digest - digest recorded on a stop.
   * @returns the stored text, or null when the object is no longer retained.
   */
  loadText(digest: string): Promise<string | null>
}

/** Everything the timeline panel renders from, independent of its slot wiring. */
export interface FileHistoryPanelProps {
  /** The folded workspace timeline of the active session. */
  history: FileHistorySnapshot
  /** Bound translate for the fileHistory namespace. */
  t: TranslateNS<typeof NS>
  /** Injected timeline actions. */
  restore: FileHistoryViewInjected['restore']
  /** Injected content reader. */
  loadText: FileHistoryViewInjected['loadText']
}

/** Slider granularity: every captured call, or one stop per turn. */
type Zoom = 'call' | 'turn'

/** Stop index pinned past the end, clamped to the file's newest stop. */
const LATEST = Number.MAX_SAFE_INTEGER

/**
 * Render the workspace snapshot timeline of the active Session: pick a file,
 * scrub its stops, and read the diff and stated purpose of each one.
 * @param props - slot runtime props: the timeline hook, the injected timeline
 *   actions, and the bound translate.
 * @returns the timeline panel.
 */
export function FileHistoryView({
  useFileHistory, t, restore, loadText,
}: ConvViewProps & InjectFace<FileHistoryViewInjected> & PropsLocale<typeof NS>) {
  const history = useFileHistory(snapshot => snapshot)
  return <FileHistoryPanel history={history} t={t} restore={restore} loadText={loadText} />
}

/**
 * Render one session's file timeline: the file list beside the stop slider, the
 * stop's stated purpose, and the diff between the bytes around that stop.
 * @param props - the folded timeline, the bound translate, and the injected reads.
 * @returns the timeline panel.
 */
export function FileHistoryPanel({ history, t, restore, loadText }: FileHistoryPanelProps) {
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [zoom, setZoom] = useState<Zoom>('call')
  const [index, setIndex] = useState(LATEST)
  const [texts, setTexts] = useState<{ before: string | null; after: string | null } | null>(null)
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const file = history.files.find(candidate => candidate.path === selected) ?? history.files[0]
  const stops = useMemo<readonly FileStop[]>(
    () => file === undefined ? [] : zoom === 'turn' ? groupStopsByTurn(file.stops) : file.stops,
    [file, zoom],
  )
  const stop = stops.length === 0 ? undefined : stops[Math.min(index, stops.length - 1)]

  const before = stop?.before
  const after = stop?.after
  useEffect(() => {
    if (before === undefined && after === undefined) {
      setTexts(null)
      return
    }
    let cancelled = false
    void (async () => {
      const [oldText, newText] = await Promise.all([
        before === undefined ? Promise.resolve(null) : loadText(before),
        after === undefined ? Promise.resolve(null) : loadText(after),
      ])
      if (!cancelled) setTexts({ before: oldText, after: newText })
    })()
    return () => {
      cancelled = true
    }
  }, [before, after, loadText])

  const diffs = useMemo<DiffHunk[]>(() => {
    if (file === undefined || stop === undefined) return []
    return [{
      path: file.path,
      // A missing prior digest is a file that did not exist; a missing after
      // digest is a deletion, which leaves nothing on the added side.
      oldText: stop.before === undefined ? null : texts?.before ?? '',
      newText: stop.after === undefined ? '' : texts?.after ?? '',
    }]
  }, [file, stop, texts])

  const onRestore = (): void => {
    const digest = stop?.after ?? stop?.before
    if (file === undefined || digest === undefined) return
    setBusy(true)
    void restore(file.path, digest).then(
      (restored) => {
        setStatus(t('stop.restored', { path: restored }))
        setBusy(false)
      },
      (reason: unknown) => {
        setStatus(reason instanceof Error ? reason.message : String(reason))
        setBusy(false)
      },
    )
  }

  return (
    <div className={css.root}>
      <div className={css.header}>
        <span className={css.title}>{t('files.title')}</span>
        <div className={css.zoom} role="group" aria-label={t('zoom.aria')}>
          <button
            type="button"
            className={zoom === 'turn' ? css.zoomActive : css.zoomButton}
            aria-pressed={zoom === 'turn'}
            onClick={() => {
              setZoom('turn')
              setIndex(LATEST)
            }}
          >
            {t('zoom.turn')}
          </button>
          <button
            type="button"
            className={zoom === 'call' ? css.zoomActive : css.zoomButton}
            aria-pressed={zoom === 'call'}
            onClick={() => {
              setZoom('call')
              setIndex(LATEST)
            }}
          >
            {t('zoom.call')}
          </button>
        </div>
      </div>
      {file === undefined
        ? <p className={css.empty}>{t('files.empty')}</p>
        : (
          <div className={css.body}>
            <ul className={css.files} aria-label={t('files.aria')}>
              {history.files.map(candidate => (
                <li key={candidate.path}>
                  <button
                    type="button"
                    className={candidate.path === file.path ? css.fileActive : css.file}
                    aria-current={candidate.path === file.path}
                    onClick={() => {
                      setSelected(candidate.path)
                      setIndex(LATEST)
                    }}
                  >
                    <span className={css.filePath}>{candidate.path}</span>
                    <span className={css.fileMeta}>{t('files.stopCount', { count: candidate.stops.length })}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={css.timeline}>
              <input
                type="range"
                className={css.slider}
                aria-label={t('slider.aria')}
                min={0}
                max={Math.max(stops.length - 1, 0)}
                value={stop === undefined ? 0 : stops.indexOf(stop)}
                onChange={(event) => {
                  setIndex(Number(event.target.value))
                }}
              />
              {stop === undefined ? null : (
                <div className={css.stop}>
                  <div className={css.stopMeta}>
                    <span className={css.tool}>{t('stop.tool', { tool: stop.toolName })}</span>
                    {stop.turn === undefined
                      ? null
                      : <span className={css.turn}>{t('stop.turn', { turn: stop.turn, step: stop.step ?? 0 })}</span>}
                    <span className={css.state}>
                      {stop.before === undefined
                        ? t('files.created')
                        : stop.after === undefined
                          ? t('files.deleted')
                          : ''}
                    </span>
                  </div>
                  <p className={stop.purpose === undefined ? css.purposeAbsent : css.purpose}>
                    {stop.purpose ?? t('stop.noPurpose')}
                  </p>
                  <DiffBlock diffs={diffs} labels={{
                    copy: t('diff.copy'),
                    copied: t('diff.copied'),
                    collapseAria: t('diff.collapseAria'),
                    expandAria: hidden => t('diff.expandAria', { hidden }),
                    collapse: t('diff.collapse'),
                    expand: hidden => t('diff.expand', { hidden }),
                    files: count => t('diff.files', { count }),
                  }} />
                  <div className={css.actions}>
                    <button type="button" className={css.restore} disabled={busy} onClick={onRestore}>
                      {busy ? t('stop.restoring') : t('stop.restore')}
                    </button>
                    {status === undefined ? null : <span className={css.status}>{status}</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  )
}
