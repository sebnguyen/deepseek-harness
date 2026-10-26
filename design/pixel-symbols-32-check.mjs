// Self-check of the 32x32 pixel-symbol derivation: re-derives every glyph from
// the cached Material Symbols Outlined SVG through design/downsample.mjs and
// asserts the committed bounded32/<glyph>.svg carries exactly those cells at
// viewBox 0 0 32 32. A drifted asset fails here.
// Run: node design/pixel-symbols-32-check.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ICONS, GRID, deriveCellsFromSvg } from './pixel-symbols-gen.mjs'

const HERE = import.meta.dirname
const OUT = join(HERE, 'pixel-symbols/bounded32')
const CACHE = join(HERE, 'pixel-symbols/material')

const key = (cells) => cells.map(([c, r]) => c + ',' + r).sort().join(' ')
let fail = 0
const assert = (cond, label) => {
  if (cond) console.log('ok:', label)
  else { fail += 1; console.error('FAIL:', label) }
}

for (const [glyph, name] of Object.entries(ICONS)) {
  const svg = readFileSync(join(OUT, glyph + '.svg'), 'utf8')
  const source = readFileSync(join(CACHE, name + '.svg'), 'utf8')
  const committed = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)"/g)].map((m) => [Math.round(+m[1]), Math.round(+m[2])])
  const derived = deriveCellsFromSvg(source, GRID)
  assert(/viewBox="0 0 32 32"/.test(svg), `${glyph}: viewBox is 0 0 32 32`)
  assert(/shape-rendering="crispEdges"/.test(svg), `${glyph}: crispEdges is on`)
  assert(committed.every(([c, r]) => c >= 0 && c < GRID && r >= 0 && r < GRID), `${glyph}: every cell is inside the grid`)
  assert(key(committed) === key(derived), `${glyph}: committed cells equal the ${name} derivation (${committed.length} vs ${derived.length})`)
}

assert(Object.keys(ICONS).length === 33, 'catalog has all 33 glyphs')
process.exit(fail ? 1 : 0)
