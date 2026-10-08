import {
  PIXEL_LOADER_CELLS_16,
  PIXEL_LOADER_CELLS_24,
  PIXEL_LOADER_CSS,
  PIXEL_LOADER_PERIOD_S,
} from './pixel-loader/generated.ts'
import type { IconProps } from './icons/props.ts'

/** Props for {@link PixelLoader}; `size` is the square edge in px. */
export interface PixelLoaderProps extends IconProps {
  /** Minted grid: 16 keeps pixels legible below ~20px chrome; 24 is the boot/turn face. */
  grid?: 16 | 24 | undefined
}

function round2(n: number): number { return Math.round(n * 100) / 100 }

/**
 * Pixel gap fraction for a rendered pitch: the locked 30% at 1px-or-better
 * cells, widening toward 50% as the pitch drops below 1px so the mark keeps
 * its silhouette where sub-pixel pixels would smear together.
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
  const inset = pixelLoaderGap(grid, sizePx) / 2
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
 * Append the shared sweep stylesheet to the document head once. Every copy of
 * the mark runs the same ladder class / `animation-delay` math, so one document
 * host serves any number of loaders, and hosts that embed the raw svg string
 * themselves (the framework-free boot page) call this before building the
 * node. The stylesheet carries the `prefers-reduced-motion` guard.
 */
export function installPixelLoaderStyles(): void {
  if (document.head.querySelector('[data-dsh-pixel-loader-style]') !== null) return
  const style = document.createElement('style')
  style.setAttribute('data-dsh-pixel-loader-style', '')
  style.textContent = PIXEL_LOADER_CSS
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
 * @returns the animated loader svg (aria-hidden; pair with a status label).
 */
export function PixelLoader({ size = 24, className, grid = 24 }: PixelLoaderProps) {
  installPixelLoaderStyles()
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      className={className}
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: pixelLoaderInner(grid, size) }}
    />
  )
}
