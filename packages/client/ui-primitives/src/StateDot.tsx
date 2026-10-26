import clsx from 'clsx'
import { PixelGlyph } from './PixelGlyph.tsx'
import { PixelLoader } from './PixelLoader.tsx'
import type { PixelSymbolName } from './pixel-symbols/symbols.ts'
import css from './StateDot.module.css'

/**
 * State semantic: green done / amber user-attention / blue DigitalOcean
 * pixel sweep while running / red error / grey idle for a tracked subject
 * with nothing in progress.
 */
export type StateDotState = 'done' | 'warning' | 'ongoing' | 'error' | 'idle'

/** The pixel mark that carries each settled state; colour stays per state. */
const STATE_GLYPHS: Record<Exclude<StateDotState, 'ongoing'>, PixelSymbolName> = {
  done: 'check',
  warning: 'pause',
  error: 'close',
  idle: 'generic',
}

/**
 * Render a state mark.
 * @param props.state - which of `done`, `warning`, `ongoing`, `error`, or `idle` to show.
 * @param props.size - outer edge in px (default 16).
 * @param props.className - extra class for layout placement.
 * @returns the state element (aria-hidden; pair with text for accessibility).
 */
export function StateDot({ state, size = 16, className }: {
  state: StateDotState
  size?: number | undefined
  className?: string | undefined
}) {
  if (state === 'ongoing') {
    // Live activity is the DigitalOcean pixel sweep in the state blue.
    return (
      <span
        className={clsx(css.matrix, className)}
        data-state="ongoing"
        aria-hidden="true"
      >
        <PixelLoader size={size} />
      </span>
    )
  }
  return (
    <span
      className={clsx(css.dot, className)}
      data-state={state}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <PixelGlyph name={STATE_GLYPHS[state]} size={size} />
    </span>
  )
}
