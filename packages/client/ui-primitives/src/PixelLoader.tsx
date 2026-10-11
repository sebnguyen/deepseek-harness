import {
  PIXEL_LOADER_CELLS_16,
  PIXEL_LOADER_CELLS_24,
  PIXEL_LOADER_CSS,
  PIXEL_LOADER_PERIOD_S,
  PIXEL_LOADER_TWINKLE_16,
  PIXEL_LOADER_TWINKLE_24,
  PIXEL_LOADER_TWINKLE_CSS,
} from './pixel-loader/generated.ts'
import type { IconProps } from './icons/props.ts'

/** Props for {@link PixelLoader}; `size` is the square edge in px. */
export interface PixelLoaderProps extends IconProps {
  /** Minted grid: 16 keeps pixels legible below ~20px chrome; 24 is the boot/turn face. */
  grid?: 16 | 24 | undefined
  /** `sweep` is the clockwise loading light; `twinkle` the random pop/fade idle brand face. */
  mode?: 'sweep' | 'twinkle' | undefined
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

/** Pixel gap at 1:1-or-better pitch: the chunkier face both modes render. */
const CHUNK_GAP = 0.2

/**
 * Pixel gap fraction for sub-pixel rendered pitches: both faces use the
 * chunkier 20% gap (`CHUNK_GAP`) at 1px-or-better cells; below 1px the gap
 * widens toward 50% so the mark keeps its silhouette where sub-pixel
 * pixels would smear together.
 * @param grid - minted grid (16 or 24).
 * @param sizePx - rendered square edge in px.
 * @returns gap as a fraction of one grid cell.
 */
export function pixelLoaderGap(grid: 16 | 24, sizePx: number): number {
  return sizePx >= grid ? 0.3 : Math.min(0.5, 0.3 + (1 - sizePx / grid) * 0.4)
}

/**
 * Build the sweep markup for one loader: one `<g class="dsh-pl">` per arc
 * bucket, each `animation-delay` that bucket's clockwise stagger added to
 * the host-shifted sweep window (`--dsh-boot-arc` /
 * `--dsh-pixel-loader-boost`). Hosts place the
 * result inside their own `<svg viewBox="0 0 N N">` and call
 * {@link installPixelLoaderStyles} once.
 * @param grid - minted grid (16 or 24).
 * @param sizePx - rendered square edge in px (drives the gap, see {@link pixelLoaderGap}).
 * @returns whitespace-free rect markup; geometry only, no style text.
 */
export function pixelLoaderInner(grid: 16 | 24, sizePx: number): string {
  const cells = grid === 16 ? PIXEL_LOADER_CELLS_16 : PIXEL_LOADER_CELLS_24
  // The sweep shares the chunkier 20% gap at 1:1-or-better pitch; only
  // sub-pixel pitches fall back to {@link pixelLoaderGap}.
  const inset = (sizePx >= grid ? CHUNK_GAP : pixelLoaderGap(grid, sizePx)) / 2
  const side = round2(1 - 2 * inset)
  const rx = Math.min(0.18, round2(side * 0.257))
  return cells.map((bucket, k) => {
    const begin = round2((k / cells.length) * PIXEL_LOADER_PERIOD_S)
    const delay = `calc(${begin}s + (var(--dsh-boot-arc, 72deg) - var(--dsh-pixel-loader-boost, 0) * 360deg) / 360deg * ${PIXEL_LOADER_PERIOD_S}s)`
    const rects = bucket.map(([c, r]) =>
      `<rect x="${round2(c + inset)}" y="${round2(r + inset)}" width="${side}" height="${side}" rx="${rx}"/>`).join('')
    return `<g opacity="0.22" class="dsh-pl" style="animation-delay: ${delay}">${rects}</g>`
  }).join('')
}

/**
 * Build the twinkle-idle markup for one loader: one self-timed `<rect
 * class="dsh-pl-tw">` per pixel, its seeded negative delay / duration pairing
 * making the dots pop and fade at random like an inference engine (the
 * starting-chat / boot brand face, as opposed to the clockwise sweep).
 * Hosts place the result inside their own `<svg viewBox="0 0 N N">` and call
 * {@link installPixelLoaderStyles} once.
 * @param grid - minted grid (16 or 24).
 * @param sizePx - rendered square edge in px (drives the gap, see {@link pixelLoaderGap}).
 * @returns whitespace-free rect markup; geometry only, no style text.
 */
export function pixelLoaderTwinkleInner(grid: 16 | 24, sizePx: number): string {
  const cells = (grid === 16 ? PIXEL_LOADER_CELLS_16 : PIXEL_LOADER_CELLS_24).flat()
  const schedule = grid === 16 ? PIXEL_LOADER_TWINKLE_16 : PIXEL_LOADER_TWINKLE_24
  // Both faces render the chunkier 20% gap at a 1:1-or-better pitch so each
  // dot reads as a fat pixel; sub-pixel pitches still fall back to
  // {@link pixelLoaderGap}.
  const gap = sizePx >= grid ? CHUNK_GAP : pixelLoaderGap(grid, sizePx)
  const inset = gap / 2
  const side = round2(1 - 2 * inset)
  const rx = Math.min(0.18, round2(side * 0.257))
  return cells.map(([c, r], i) => {
    // The minted schedule is index-aligned with the flattened cells; the
    // unchecked-index hole still deserves a live default rather than a crash.
    const entry = schedule[i]
    const delay = entry?.[0] ?? 0
    const dur = entry?.[1] ?? PIXEL_LOADER_PERIOD_S
    return `<rect class="dsh-pl-tw" style="animation-duration:${dur}s;animation-delay:${delay}s" x="${round2(c + inset)}" y="${round2(r + inset)}" width="${side}" height="${side}" rx="${rx}"/>`
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
 * Render the pixelized DigitalOcean loading mark: per-bucket pixel groups
 * carry the shared step-end opacity ladder (see
 * `design/pixel-do-loader-gen.mjs` for the recipe) in clockwise order from
 * 12 o'clock, so the light runs around the mark. Theming rides
 * `currentColor`; hosts may shift the whole sweep window through
 * `--dsh-boot-arc` / `--dsh-pixel-loader-boost`. The markup holds geometry
 * only, so host `textContent` stays clean for status labels.
 * @param props.grid - 16 for small chrome, 24 otherwise (default 24).
 * @param props.mode - `sweep` (default) runs the clockwise light; `twinkle`
 * idles the mark with random dot pop & fade.
 * @returns the animated loader svg (aria-hidden; pair with a status label).
 */
export function PixelLoader({ size = 24, className, grid = 24, mode = 'sweep' }: PixelLoaderProps) {
  installPixelLoaderStyles()
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      className={className}
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{
        __html: mode === 'twinkle' ? pixelLoaderTwinkleInner(grid, size) : pixelLoaderInner(grid, size),
      }}
    />
  )
}
