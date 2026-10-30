import { PIXEL_MARK_32_PATH } from './pixel-loader/mark-32.ts'
import type { IconProps } from './icons/props.ts'

/**
 * The DigitalOcean mark as a 32x32 pixel silhouette, derived from the logo
 * path through design/downsample.mjs at N=32. One path, with the shared 20%
 * gap baked into the cell geometry.
 * @param props.size - square edge in px; use a multiple of 32 so every cell lands on whole pixels.
 * @returns the static 32-grid pixel mark (aria-hidden).
 */
export function PixelMark32({ size = 32, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      shapeRendering="crispEdges"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={PIXEL_MARK_32_PATH} />
    </svg>
  )
}
