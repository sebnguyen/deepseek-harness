import { PIXEL_LOADER_STABLE_GRID, PIXEL_MARK_PATH } from './pixel-loader/generated.ts'
import type { IconProps } from './icons/props.ts'

/**
 * The DigitalOcean mark as a solid pixel silhouette: the same minted cells the
 * pixel loader animates, drawn once at full opacity as ONE path — every cell is
 * an inset square subpath with the shared 20% gap in geometry, so a mark costs
 * one node instead of one rect per cell (and needs no per-cell clip-path).
 * The loader's sweep and twinkle faces leave unlit pixels at 22%, which reads as
 * a smudge at 24px; this face is meant to be recognised as the brand, so every
 * pixel is solid.
 * @param props.size - square edge in px.
 * @returns the static pixel mark (aria-hidden).
 */
export function PixelMark({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${PIXEL_LOADER_STABLE_GRID} ${PIXEL_LOADER_STABLE_GRID}`}
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={PIXEL_MARK_PATH} />
    </svg>
  )
}
