// Ship the 16x16 symbol set as full-cell geometry and regenerate every catalog
// that embeds it. The gap is no longer baked into the artwork: each lit cell is
// a 1x1 rect at integer coordinates with no corner radius, and the gap comes
// from `PIXEL_SYMBOL_GAP_CSS`, which clips half the gap off every side of a cell.
//
// Run: node design/pixel-symbols-set-gap.mjs [--gap 0.20]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dirname
const ROOT = join(HERE, '..')
const BOUNDED = join(HERE, 'pixel-symbols', 'bounded')
const SYMBOLS_TS = join(ROOT, 'packages', 'client', 'ui-primitives', 'src', 'pixel-symbols', 'symbols.ts')
const UITOOL_TS = join(ROOT, 'packages', 'client', 'ui-tool', 'src', 'client', 'tool', 'pixel-symbols.generated.ts')

const at = process.argv.indexOf('--gap')
const GAP = at === -1 ? 0.20 : Number(process.argv[at + 1])
if (!(GAP > 0 && GAP < 1)) throw new Error(`gap must be in (0,1), got ${GAP}`)

const pct = Math.round(GAP * 100)
const insetPct = Number(((GAP / 2) * 100).toFixed(2))

const FILES = { add: 'add-bound', adjust: 'adjust-bound', ask: 'Ask-question-bound', attach: 'attatch-bound', bash: 'bash-bounded', check: 'check-bounded', clock: 'clock-bound', close: 'cross-bounded', context: 'context-injection-bounded', copy: 'copy-bound', error: 'error-bound', 'folder-add': 'folder-add', 'folder-close': 'folder-close-bound', 'folder-open': 'folder-open-bound', fork: 'fork-bound', generic: 'generic-tool-bounded', 'image-read': 'image-read-bound', internet: 'Interet-bound', 'model-provider': 'model-provider-bound', 'narrate-mode': 'narrate-mode-bound', pause: 'paude-bound', 'quiet-mode': 'quiet-mode-bound', read: 'read_bounded', reload: 'reload-bound', send: 'Send-bound', setting: 'setting-bound', statistic: 'statistc-bound', think: 'think-bounded', 'thumb-down': 'thump-down-bound', 'thumb-up': 'thump-up-bound', todo: 'to-do-bound', token: 'token-bound', write: 'write_bounded' }

const HEADER = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 16 16" fill="#0063f8">'

/** Rebuild one asset as full-cell geometry: one 1x1 rect at each lit cell. */
function fullCell(svg) {
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)"/g)]
    .map(([, x, y]) => `<rect x="${Math.round(Number(x))}" y="${Math.round(Number(y))}" width="1" height="1"/>`)
  if (rects.length === 0) throw new Error('asset has no rects')
  return `${HEADER}${rects.join('')}</svg>\n`
}

function bodyOf(svg) {
  return svg.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

const names = Object.keys(FILES).sort()
const bodies = new Map()
for (const name of names) {
  const file = join(BOUNDED, FILES[name] + '.svg')
  const next = fullCell(readFileSync(file, 'utf8'))
  writeFileSync(file, next)
  const body = bodyOf(next)
  if (body.includes('rx=')) throw new Error(`${name}: corner radius leaked into geometry`)
  bodies.set(name, body)
}

const rows = names.map((name) => `  ${JSON.stringify(name)}: { viewBox: "0 0 16 16", body: ${JSON.stringify(bodies.get(name))} },`).join('\n')
const gapCss = `svg[data-glyph] rect{clip-path:inset(${insetPct}%)}`

function catalog(note) {
  return `// Generated from deepseek-harness/design/pixel-symbols/bounded/*.svg.
// Geometry is full-cell: one 1x1 rect per lit cell at integer coordinates and no
// corner radius. The ${pct}% gap is CSS, not artwork.${note}

export interface PixelSymbol { viewBox: string, body: string }

/** ${pct}% inter-cell gap: each cell is clipped ${insetPct}% off every side. */
export const PIXEL_SYMBOL_GAP_CSS = ${JSON.stringify(gapCss)}

export const PIXEL_SYMBOLS = {
${rows}
} as const

export type PixelSymbolName = keyof typeof PIXEL_SYMBOLS
`
}

writeFileSync(SYMBOLS_TS, catalog(''))
writeFileSync(UITOOL_TS, catalog('\n// Do not hand-edit.'))

console.log(`rewrote ${names.length} assets + 2 catalogs at ${pct}% CSS gap (inset ${insetPct}%)`)
