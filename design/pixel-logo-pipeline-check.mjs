// Self-check of the pixel-mark derivation: re-derives the stable 16x16 grid
// from website/public/favicon.svg (hard downsample -> 16x16 coverage window)
// and asserts the buckets generated into
// packages/client/ui-primitives/src/pixel-loader/generated.ts carry exactly the
// derived cells, so the shipped face cannot drift from the pipeline, and that
// the 16/24 scale switch has not crept back in.
// Run: node design/pixel-logo-pipeline-check.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveCells } from './downsample.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const d = readFileSync(join(ROOT, 'website/public/favicon.svg'), 'utf8').match(/d="([^"]+)"/)[1]
const gen = readFileSync(join(ROOT, 'packages/client/ui-primitives/src/pixel-loader/generated.ts'), 'utf8')

function cellsOfCells() {
  const m = gen.match(/export const PIXEL_LOADER_CELLS: [^=]*= (\[\[\[[\s\S]*?\]\]\])\n/)
  if (!m) throw new Error('cannot locate PIXEL_LOADER_CELLS in generated.ts')
  return JSON.parse(m[1]).flat()
}
const key = (cells) => cells.map(([c, r]) => c + ',' + r).sort().join(' ')

let fail = 0
const assert = (cond, label) => { if (!cond) { fail += 1; console.error('FAIL:', label) } else { console.log('ok:', label) } }

const derived = deriveCells(d, 16)
const shipped = cellsOfCells()
const dKey = key(derived), sKey = key(shipped)
const added = derived.filter(([c, r]) => !shipped.some(([cc, rr]) => cc === c && rr === r)).length
const missing = shipped.filter(([c, r]) => !derived.some(([cc, rr]) => cc === c && rr === r)).length
assert(dKey === sKey, `generated 16x16 grid equals the coverage derivation (got +${added}/-${missing})`)
assert(derived.length > 60, 'coverage at 16 yields the mark')
assert(/export const PIXEL_LOADER_STABLE_GRID = 16\b/.test(gen), 'generated module pins the stable 16 grid')
assert(!/PIXEL_LOADER_CELLS_24/.test(gen), 'no 24-grid sweep data remains')
assert(!/PIXEL_LOADER_TWINKLE_24/.test(gen), 'no 24-grid twinkle data remains')
process.exit(fail ? 1 : 0)
