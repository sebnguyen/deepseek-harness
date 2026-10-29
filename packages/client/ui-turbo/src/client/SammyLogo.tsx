/**
 * Static 16x16 Sammy mark: the two-tone pixel cutout (DigitalOcean teal and
 * white), transparent outside the shark. Hover color comes from the card's
 * grayscale-to-color transition, not from this component.
 */
const ROWS = [
  '................',
  '................',
  '................',
  '.....b..........',
  'b....bb.........',
  '.b...bbbbbbbbb..',
  '.bbbbbbbbbbbbbbb',
  'bbbbbbbbbbbbbbb.',
  '...bbbbbbbbbbbb.',
  '....bbbbbbbwww..',
  '.....bbbwbbbw...',
  '....bbbwwwwbb...',
  '.......wwwww....',
  '................',
  '................',
  '................',
] as const

const TEAL = '#7BB4BC'
const WHITE = '#ffffff'

type SammyLogoProps = {
  /** Square edge length in px. */
  size?: number
  /** Extra class for layout placement. */
  className?: string
}

/** Render the static Sammy pixel mark. */
export function SammyLogo({ size = 112, className }: SammyLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {ROWS.flatMap((row, y) => [...row].map((cell, x) => (
        cell === '.'
          ? null
          : (
            <rect
              key={`${x}-${y}`}
              x={x + 0.1}
              y={y + 0.1}
              width={0.8}
              height={0.8}
              rx={0.08}
              fill={cell === 'b' ? TEAL : WHITE}
            />
          )
      )))}
    </svg>
  )
}
