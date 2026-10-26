/** Client-bundled catalog glyph renderer (keeps all 33 symbol bodies in the
 *  tool client bundle for the glyph-coverage audit). */
import { PIXEL_SYMBOLS, type PixelSymbolName } from '../pixel-symbols.generated.ts'

/** Props for the inline catalog glyph. */
export interface InlinePixelGlyphProps {
  name: PixelSymbolName
  size?: number
  className?: string | undefined
}

/**
 * Draw one catalog symbol from the client-local generated module.
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
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      data-glyph={name}
      dangerouslySetInnerHTML={{ __html: symbol.body }}
    />
  )
}
