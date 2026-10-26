// Retune the 16x16 symbol set's per-cell gap and regenerate every catalog that
// embeds the geometry. The gap is a fraction of a cell; the default is 32%
// (0.68 cell inset 0.16), the value the gap scrubber settled on. The corner
// radius is left at the artwork's own 0.10.
//
// Run: node design/pixel-symbols-set-gap.mjs [--gap 0.32]
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dirname
const ROOT = join(HERE, '..')
const BOUNDED = join(HERE, 'pixel-symbols', 'bounded')
const SYMBOLS_TS = join(ROOT, 'packages', 'client', 'ui-primitives', 'src', 'pixel-symbols', 'symbols.ts')
const UITOOL_TS = join(ROOT, 'packages', 'client', 'ui-tool', 'src', 'client', 'tool', 'pixel-symbols.generated.ts')

const at = process.argv.indexOf('--gap')
const GAP = at === -1 ? 0.32 : Number(process.argv[at + 1])
if (!(GAP > 0 && GAP < 1)) throw new Error(`gap must be in (0,1), got ${GAP}`)
const INSET = GAP / 2
const SIDE = 1 - GAP
const inset = INSET.toFixed(2)
const side = SIDE.toFixed(2)

const FILES = { add: 'add-bound', adjust: 'adjust-bound', ask: 'Ask-question-bound', attach: 'attatch-bound', bash: 'bash-bounded', check: 'check-bounded', clock: 'clock-bound', close: 'cross-bounded', context: 'context-injection-bounded', copy: 'copy-bound', error: 'error-bound', 'folder-add': 'folder-add', 'folder-close': 'folder-close-bound', 'folder-open': 'folder-open-bound', fork: 'fork-bound', generic: 'generic-tool-bounded', 'image-read': 'image-read-bound', internet: 'Interet-bound', 'model-provider': 'model-provider-bound', 'narrate-mode': 'narrate-mode-bound', pause: 'paude-bound', 'quiet-mode': 'quiet-mode-bound', read: 'read_bounded', reload: 'reload-bound', send: 'Send-bound', setting: 'setting-bound', statistic: 'statistc-bound', think: 'think-bounded', 'thumb-down': 'thump-down-bound', 'thumb-up': 'thump-up-bound', todo: 'to-do-bound', token: 'token-bound', write: 'write_bounded' }

function bodyOf(svg) {
  return svg.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

function regap(svg) {
  let rects = 0
  const out = svg.replace(/<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="[\d.]+" rx="([\d.]+)"\/>/g, (_, x, y, rx) => {
    rects += 1
    const c = Math.round(Number(x))
    const r = Math.round(Number(y))
    return `<rect x="${(c + INSET).toFixed(2)}" y="${(r + INSET).toFixed(2)}" width="${side}" height="${side}" rx="${rx}"/>`
  })
  const declared = (svg.match(/<rect/g) ?? []).length
  if (rects === 0 || rects !== declared) throw new Error(`rect rewrite missed (${rects}/${declared})`)
  return out
}

const names = Object.keys(FILES).sort()
const bodies = new Map()
for (const name of names) {
  const file = join(BOUNDED, FILES[name] + '.svg')
  const next = regap(readFileSync(file, 'utf8'))
  writeFileSync(file, next)
  bodies.set(name, bodyOf(next))
}

const rows = names.map((name) => `  ${JSON.stringify(name)}: { viewBox: "0 0 16 16", body: ${JSON.stringify(bodies.get(name))} },`).join('\n')

writeFileSync(SYMBOLS_TS, `// Generated from deepseek-harness/design/pixel-symbols/bounded/*.svg.
// Geometry is the artwork's own (${side} cells inset ${inset}, rx 0.10 => the gapped
// pixel look); only the ink colour is normalised to currentColor.

export interface PixelSymbol { viewBox: string, body: string }

export const PIXEL_SYMBOLS = {
${rows}
} as const

export type PixelSymbolName = keyof typeof PIXEL_SYMBOLS
`)

writeFileSync(UITOOL_TS, `// Generated from deepseek-harness/design/pixel-symbols/bounded/*.svg.
// 16-unit grid, gapped rects (${side} cells inset ${inset}, rx 0.10). Do not hand-edit.

export interface PixelSymbol { viewBox: string, body: string }

export const PIXEL_SYMBOLS = {
${rows}
} as const

export type PixelSymbolName = keyof typeof PIXEL_SYMBOLS
`)

const pct = Math.round(GAP * 100)
console.log(`rewrote ${names.length} assets + 2 catalogs at ${pct}% gap (inset ${inset}, side ${side})`)
