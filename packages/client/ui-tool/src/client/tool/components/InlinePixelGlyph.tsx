/** Client-bundled catalog glyph renderer (keeps all 33 symbol bodies in the
 *  tool client bundle for the glyph-coverage audit). */
import { PIXEL_SYMBOLS, PIXEL_SYMBOL_GAP_CSS, type PixelSymbolName } from '../pixel-symbols.generated.ts'

/** Props for the inline catalog glyph. */
export interface InlinePixelGlyphProps {
  name: PixelSymbolName
  size?: number
  className?: string | undefined
}

/**
 * Draw one catalog symbol from the client-local generated module. The artwork
 * is full-cell; the 30% gap is the catalog's `PIXEL_SYMBOL_GAP_CSS` clip.
 * @param props - symbol name, square edge, optional class.
 * @returns the aria-hidden inline svg.
 */
export function InlinePixelGlyph({ name, size = 16, className }: InlinePixelGlyphProps) {
  const symbol = PIXEL_SYMBOLS[name]
  return (
    <svg
      width={size}
      height={size}
      viewBox={symbol.viewBox}
      className={className}
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      data-glyph={name}
    >
      <style>{PIXEL_SYMBOL_GAP_CSS}</style>
      <g dangerouslySetInnerHTML={{ __html: symbol.body }} />
    </svg>
  )
}
