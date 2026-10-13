// Self-check of the pixel-mark derivation: re-derives the 16/24 grids from
// website/public/favicon.svg (hard downsample -> coverage window sample) and
// asserts the buckets generated into
// packages/client/ui-primitives/src/pixel-loader/generated.ts carry exactly the
// derived cells, so the shipped faces cannot drift from the pipeline.
// Run: node design/pixel-logo-pipeline-check.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveCells } from './downsample.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const d = readFileSync(join(ROOT, 'website/public/favicon.svg'), 'utf8').match(/d="([^"]+)"/)[1]
const gen = readFileSync(join(ROOT, 'packages/client/ui-primitives/src/pixel-loader/generated.ts'), 'utf8')

function cellsOf(name) {
  const m = gen.match(new RegExp(name + '[^=]*= (\\[\\[\\[[\\s\\S]*?\\]\\]\\])\n'))
  if (!m) throw new Error('cannot locate ' + name + ' in generated.ts')
  return JSON.parse(m[1]).flat()
}
const key = (cells) => cells.map(([c, r]) => c + ',' + r).sort().join(' ')

let fail = 0
const assert = (cond, label) => { if (!cond) { fail += 1; console.error('FAIL:', label) } else { console.log('ok:', label) } }

for (const N of [16, 24]) {
  const derived = deriveCells(d, N)
  const shipped = cellsOf('PIXEL_LOADER_CELLS_' + N)
  const dKey = key(derived), sKey = key(shipped)
  const added = derived.filter(([c, r]) => !shipped.some(([cc, rr]) => cc === c && rr === r)).length
  const missing = shipped.filter(([c, r]) => !derived.some(([cc, rr]) => cc === c && rr === r)).length
  assert(dKey === sKey, `generated ${N}x${N} equals the coverage derivation (got +${added}/-${missing})`)
}
assert(deriveCells(d, 24).length > 150, 'coverage at 24 yields the full mark')
assert(deriveCells(d, 16).length > 60, 'coverage at 16 yields the mark')
process.exit(fail ? 1 : 0)
