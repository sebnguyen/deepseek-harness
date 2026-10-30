/**
 * Static 32x32 Sammy mark: the two-tone pixel cutout (DigitalOcean teal and
 * white), transparent outside the shark. Hover color comes from the card's
 * grayscale-to-color transition, not from this component.
 */
import { SAMMY_32_TEAL_PATH, SAMMY_32_WHITE_PATH } from './SammyLogo32.ts'

const TEAL = '#7BB4BC'
const WHITE = '#ffffff'

type SammyLogoProps = {
  /** Square edge length in px. Use a multiple of 32 so every cell lands on whole pixels. */
  size?: number
  /** Extra class for layout placement. */
  className?: string
}

/** Render the static 32-grid Sammy pixel mark. */
export function SammyLogo({ size = 32, className }: SammyLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <path d={SAMMY_32_TEAL_PATH} fill={TEAL} />
      <path d={SAMMY_32_WHITE_PATH} fill={WHITE} />
    </svg>
  )
}
