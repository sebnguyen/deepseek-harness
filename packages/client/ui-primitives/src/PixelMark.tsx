import { PIXEL_LOADER_CELLS, PIXEL_LOADER_STABLE_GRID } from './pixel-loader/generated.ts'
import type { IconProps } from './icons/props.ts'

/** Gap fraction and radius of one pixel, matching the loader's chunky face. */
const INSET = 0.1
const SIDE = 0.8
const RX = 0.2

/**
 * The DigitalOcean mark as a solid pixel silhouette: the same minted cells the
 * pixel loader animates, drawn once at full opacity. The loader's sweep and
 * twinkle faces leave unlit pixels at 22%, which reads as a smudge at 24px;
 * this face is meant to be recognised as the brand, so every pixel is solid.
 * @param props.size - square edge in px.
 * @returns the static pixel mark (aria-hidden).
 */
export function PixelMark({ size = 16, className }: IconProps) {
  const cells = PIXEL_LOADER_CELLS.flat()
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${PIXEL_LOADER_STABLE_GRID} ${PIXEL_LOADER_STABLE_GRID}`}
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      {cells.map(([column, row], index) => (
        <rect
          key={`${column}-${row}-${index}`}
          x={column + INSET}
          y={row + INSET}
          width={SIDE}
          height={SIDE}
          rx={RX}
        />
      ))}
    </svg>
  )
}
