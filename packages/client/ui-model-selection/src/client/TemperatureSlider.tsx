/**
 * TemperatureSlider: the composer's `conversation.input.temperature` seat — a
 * compact 0.0–1.0 sampling-temperature slider over the SAME per-session
 * ModelDirectory as the model seat and the /model popup. Sliding submits a
 * complete selection (unchanged provider/model/reasoning effort, new
 * temperature) through `session.selectModel`, so the value persists on the
 * durable projection and every entry shows the same session state.
 */
import {
  useEffect, useRef, useState, useSyncExternalStore, type ChangeEvent, type PointerEvent,
} from 'react'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import css from './TemperatureSlider.module.css'

/** DigitalOcean chat-completions sampling range. */
const MIN = 0
const MAX = 1
/** Near-continuous granularity for the "sliding scale". */
const STEP = 0.05
/** Fallback shown while the durable selection has not resolved a temperature. */
const DEFAULT = 0.2
/** Coalesce drag steps into one selectModel round-trip. */
const COMMIT_MS = 120

/** Render one temperature with a fixed two-decimal width. */
function format(value: number): string {
  return value.toFixed(2)
}

/**
 * Render the composer sampling-temperature slider.
 * @param props - the shared directory store and `select` verb, the owner
 * `locked` flag, and the standard locale seat.
 * @returns the slider and readout, or nothing for sessions without selection.
 */
export function TemperatureSlider(
  { available, directory, load, select, locked, t }:
    ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draft, setDraft] = useState<number | null>(null)

  useEffect(() => {
    if (available) load()
  }, [available, load])

  useEffect(() => () => {
    if (commitTimer.current !== null) clearTimeout(commitTimer.current)
  }, [])

  const current = state.current
  const committed = current?.temperature ?? DEFAULT
  const shown = draft ?? committed

  useEffect(() => {
    if (draft !== null && current?.temperature === draft) setDraft(null)
  }, [current?.temperature, draft])

  if (!available) return null

  const disabled = locked || current === null

  const commit = (temperature: number): void => {
    if (current === null) return
    const selection: ModelSelection = {
      provider: current.provider,
      model: current.model,
      ...(current.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: current.reasoningEffort }),
      temperature,
    }
    void select(selection)
  }

  const queueCommit = (temperature: number): void => {
    setDraft(temperature)
    if (commitTimer.current !== null) clearTimeout(commitTimer.current)
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null
      commit(temperature)
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

  return (
    <label className={css.root} title={t('temperature.label')}>
      <input
        type="range"
        className={css.slider}
        min={MIN}
        max={MAX}
        step={STEP}
        value={shown}
        disabled={disabled}
        aria-label={t('temperature.label')}
        aria-valuetext={format(shown)}
        onChange={onChange}
        onPointerUp={onPointerUp}
      />
      <span className={css.value}>{format(shown)}</span>
    </label>
  )
}
