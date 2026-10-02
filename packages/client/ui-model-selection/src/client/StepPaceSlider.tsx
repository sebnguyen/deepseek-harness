/**
 * StepPaceSlider: the composer's `conversation.input.stepPace` seat — a compact
 * 0–10s minimum-interval slider over the SAME per-session ModelDirectory as the
 * model and temperature seats. Sliding submits the pace through the directory's
 * `setPace`, so the value persists on the durable projection and every load of
 * the GUI shows the same session state. The wait gives the provider time to
 * persist the previous request's prefix into its disk cache.
 */
import {
  useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type CSSProperties, type PointerEvent,
} from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StepPaceInjected } from './slots.ts'
import css from './StepPaceSlider.module.css'

/** Milliseconds per slider second. */
const MS_PER_SECOND = 1000
/** Seconds between consecutive dispatches at the top of the scale. */
const MIN = 0
const MAX = 10
/** Half-second granularity. */
const STEP = 0.5
/** Coalesce drag steps into one setStepPace round-trip. */
const COMMIT_MS = 120

/** Render one pace in seconds with a fixed width. */
function format(seconds: number): string {
  return `${seconds.toFixed(1)}s`
}

/**
 * Render the composer step-pace slider.
 * @param props - the shared directory store and `setPace` verb, the owner
 * `locked` flag, and the standard locale seat.
 * @returns the slider and readout, or nothing for unavailable sessions.
 */
export function StepPaceSlider(
  { available, directory, setPace, locked, t }: StepPaceInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draft, setDraft] = useState<number | null>(null)

  useEffect(() => () => {
    if (commitTimer.current !== null) clearTimeout(commitTimer.current)
  }, [])

  const committedSeconds = (state.pace?.ms ?? 0) / MS_PER_SECOND
  const shown = draft ?? committedSeconds

  useEffect(() => {
    if (draft !== null && committedSeconds === draft) setDraft(null)
  }, [committedSeconds, draft])

  if (!available) return null

  const commit = (seconds: number): void => {
    void setPace(Math.round(seconds * MS_PER_SECOND))
  }

  const queueCommit = (seconds: number): void => {
    setDraft(seconds)
    if (commitTimer.current !== null) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null
      commit(seconds)
    }, COMMIT_MS)
  }

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    queueCommit(Number(event.target.value))
  }

  const onPointerUp = (event: PointerEvent<HTMLInputElement>): void => {
    if (commitTimer.current === null) return
    clearTimeout(commitTimer.current)
    commitTimer.current = null
    commit(Number(event.currentTarget.value))
  }

  const fillPercent = ((shown - MIN) / (MAX - MIN)) * 100
  const sliderStyle = { '--step-pace-fill': `${fillPercent}%` } as CSSProperties

  return (
    <label className={css.root} title={t('stepPace.label')}>
      <input
        type="range"
        className={css.slider}
        style={sliderStyle}
        min={MIN}
        max={MAX}
        step={STEP}
        value={shown}
        disabled={locked}
        aria-label={t('stepPace.label')}
        aria-valuetext={format(shown)}
        onChange={onChange}
        onPointerUp={onPointerUp}
      />
      <span className={css.value}>{format(shown)}</span>
    </label>
  )
}
