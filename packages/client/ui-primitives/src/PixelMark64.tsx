import { PIXEL_MARK_64_PATH } from './pixel-loader/mark-64.ts'
import type { IconProps } from './icons/props.ts'

/**
 * The DigitalOcean mark as a 64x64 pixel silhouette, derived from the logo
 * path through design/downsample.mjs at N=64. One path, with the shared 20%
 * gap baked into the cell geometry.
 * @param props.size - square edge in px; use a multiple of 64 so every cell lands on whole pixels.
 * @returns the static 64-grid pixel mark (aria-hidden).
 */
export function PixelMark64({ size = 64, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={PIXEL_MARK_64_PATH} />
    </svg>
  )
}
