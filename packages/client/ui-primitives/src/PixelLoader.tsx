import {
  PIXEL_LOADER_CELL_CLIP,
  PIXEL_LOADER_CELLS,
  PIXEL_LOADER_CSS,
  PIXEL_LOADER_PERIOD_S,
  PIXEL_LOADER_STABLE_GRID,
  PIXEL_LOADER_TWINKLE,
  PIXEL_LOADER_TWINKLE_CSS,
  PIXEL_MARK_PATH,
} from './pixel-loader/generated.ts'
import type { IconProps } from './icons/props.ts'

/** Props for {@link PixelLoader}; `size` is the square edge in px. */
export interface PixelLoaderProps extends IconProps {
  /** `sweep` is the clockwise loading light; `twinkle` the random pop/fade idle brand face. */
  mode?: 'sweep' | 'twinkle' | undefined
}

/**
 * Build the sweep markup for one loader: a single static path for the whole mark,
 * lit by the animated conic mask the shared stylesheet installs. One node, one
 * animation, no per-cell timing. Hosts place the result inside their own
 * `<svg viewBox="0 0 16 16">` and call {@link installPixelLoaderStyles} once.
 * @returns whitespace-free markup; geometry and class only, no style text.
 */
export function pixelLoaderInner(): string {
  return `<path class="dsh-pl" d="${PIXEL_MARK_PATH}"/>`
}

/**
 * Build the twinkle-idle markup for one loader: one self-timed `<rect
 * class="dsh-pl-tw">` per pixel, its seeded negative delay / duration pairing
 * making the dots pop and fade at random like an inference engine (the
 * starting-chat / boot brand face, as opposed to the clockwise sweep).
 * Hosts place the result inside their own `<svg viewBox="0 0 16 16">` and call
 * {@link installPixelLoaderStyles} once.
 * @returns whitespace-free rect markup; geometry only, no style text.
 */
export function pixelLoaderTwinkleInner(): string {
  return PIXEL_LOADER_CELLS.flat().map(([c, r], i) => {
    // The minted schedule is index-aligned with the flattened cells; the
    // unchecked-index hole still deserves a live default rather than a crash.
    const entry = PIXEL_LOADER_TWINKLE[i]
    const delay = entry?.[0] ?? 0
    const dur = entry?.[1] ?? PIXEL_LOADER_PERIOD_S
    return `<rect class="dsh-pl-tw" style="animation-duration:${dur}s;animation-delay:${delay}s" x="${c}" y="${r}" width="1" height="1" clip-path="${PIXEL_LOADER_CELL_CLIP}"/>`
  }).join('')
}

/**
 * Append the shared sweep + twinkle stylesheets to the document head once. Every copy of
 * the mark runs the same ladder class / `animation-delay` math, so one document
 * host serves any number of loaders, and hosts that embed the raw svg string
 * themselves (the framework-free boot page) call this before building the
 * node. The stylesheet carries the `prefers-reduced-motion` guard.
 */
export function installPixelLoaderStyles(): void {
  if (document.head.querySelector('[data-dsh-pixel-loader-style]') !== null) return
  const style = document.createElement('style')
  style.setAttribute('data-dsh-pixel-loader-style', '')
  style.textContent = `${PIXEL_LOADER_CSS}\n${PIXEL_LOADER_TWINKLE_CSS}`
  document.head.append(style)
}

/**
 * Render the stable pixelized DigitalOcean loading mark: one 16x16 grid at
 * every rendered size, so the pixel scale never changes between small chrome
 * and the boot/turn face. Per-bucket pixel groups carry the shared step-end
 * opacity ladder (see `design/pixel-do-loader-gen.mjs` for the recipe) in
 * clockwise order from 12 o'clock, so the light runs around the mark. Theming
 * rides `currentColor`; hosts may shift the whole sweep window through
 * `--dsh-boot-arc` / `--dsh-pixel-loader-boost`. The markup holds geometry
 * only, so host `textContent` stays clean for status labels.
 * @param props.mode - `sweep` (default) runs the clockwise light; `twinkle`
 * idles the mark with random dot pop & fade.
 * @returns the animated loader svg (aria-hidden; pair with a status label).
 */
export function PixelLoader({ size = 32, className, mode = 'sweep' }: PixelLoaderProps) {
  installPixelLoaderStyles()
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${PIXEL_LOADER_STABLE_GRID} ${PIXEL_LOADER_STABLE_GRID}`}
      className={className}
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: mode === 'twinkle' ? pixelLoaderTwinkleInner() : pixelLoaderInner(),
      }}
    />
  )
}
