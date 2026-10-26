// Derive the pixel-symbol set from the Material Symbols Outlined SVGs through
// the same hard-downsample engine as the DigitalOcean mark: flatten the
// vector, trim it to its ink bounds, fit it to the engine's 24x24 canvas, then
// keep an NxN cell when its coverage window crosses 50%. Nothing is hand-traced.
//
// Source art: https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/<name>/default/24px.svg
// (Material Symbols Outlined, FILL 0, wght 400, GRAD 0, opsz 24 — the Google
// Fonts link's defaults). Fetched sources are cached under
// design/pixel-symbols/material/<name>.svg so a rerun is byte-identical.
//
// Outputs: design/pixel-symbols/bounded32/<glyph>.svg
// Run: node design/pixel-symbols-gen.mjs [--refresh]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { flattenPath, rasterCoverage, coverageCells } from './downsample.mjs'

const HERE = import.meta.dirname
const OUT = join(HERE, 'pixel-symbols/bounded32')
const CACHE = join(HERE, 'pixel-symbols/material')
export const GRID = 32
const THRESHOLD = 0.5
const INSET = 0.1

// glyph -> Material Symbols Outlined name. `error` is Material's `dangerous`:
// the source link's selected icon, and an exact 16x16 match to the old cell set.
export const ICONS = {
  add: 'add',
  adjust: 'tune',
  ask: 'help',
  attach: 'attach_file',
  bash: 'terminal',
  check: 'check',
  clock: 'schedule',
  close: 'close',
  context: 'note_add',
  copy: 'content_copy',
  error: 'dangerous',
  'folder-add': 'create_new_folder',
  'folder-close': 'folder',
  'folder-open': 'folder_open',
  fork: 'fork_right',
  generic: 'construction',
  'image-read': 'image_search',
  internet: 'public',
  'model-provider': 'smart_toy',
  'narrate-mode': 'volume_up',
  pause: 'pause',
  'quiet-mode': 'volume_off',
  read: 'description',
  reload: 'refresh',
  send: 'send',
  setting: 'settings',
  statistic: 'insert_chart',
  think: 'psychology',
  'thumb-down': 'thumb_down',
  'thumb-up': 'thumb_up',
  todo: 'checklist',
  token: 'token',
  write: 'edit',
}

function round2(n) { return Math.round(n * 100) / 100 }

/** Flatten every <path> in the SVG, map its viewBox to the engine's 24x24
 * canvas, then trim to the ink bounds and fit (centred) so Material's 960-box
 * padding cannot shrink the glyph. */
export function polysFor(svg) {
  const vm = svg.match(/viewBox="([^"]+)"/)
  const vb = vm ? vm[1].trim().split(/[ ,]+/).map(Number) : [0, 0, 24, 24]
  const polys = []
  for (const m of svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)) {
    for (const poly of flattenPath(m[1])) {
      polys.push(poly.map(([x, y]) => [(x - vb[0]) * 24 / vb[2], (y - vb[1]) * 24 / vb[3]]))
    }
  }
  if (!polys.length) throw new Error('no <path> geometry in the fetched SVG')
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of polys) for (const [x, y] of poly) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const w = maxX - minX, h = maxY - minY
  const s = 24 / Math.max(w, h)
  const ox = (24 - w * s) / 2 - minX * s
  const oy = (24 - h * s) / 2 - minY * s
  return polys.map((poly) => poly.map(([x, y]) => [x * s + ox, y * s + oy]))
}

export function deriveCellsFromSvg(svg, N = GRID) {
  const S = N * 16
  return coverageCells(rasterCoverage(polysFor(svg), S), S, N, THRESHOLD)
}

export function symbolSvg(cells, N = GRID) {
  const side = round2(1 - 2 * INSET)
  const rects = cells.map(([c, r]) =>
    `<rect x="${round2(c + INSET)}" y="${round2(r + INSET)}" width="${side}" height="${side}" rx="0.10"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 ${N} ${N}" fill="#0063f8" shape-rendering="crispEdges">${rects}</svg>\n`
}

async function fetchIcon(name, refresh) {
  const file = join(CACHE, name + '.svg')
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8')
  const url = `https://fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/${name}/default/24px.svg`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} from ${url}`)
  const text = await res.text()
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(file, text)
  return text
}

async function main() {
  const refresh = process.argv.includes('--refresh')
  const sources = new Map()
  for (const [glyph, name] of Object.entries(ICONS)) sources.set(glyph, await fetchIcon(name, refresh))

  mkdirSync(OUT, { recursive: true })
  const rows = []
  for (const [glyph, svg] of sources) {
    const cells = deriveCellsFromSvg(svg, GRID)
    if (!cells.length) throw new Error(`${glyph}: derivation produced no cells`)
    writeFileSync(join(OUT, glyph + '.svg'), symbolSvg(cells, GRID))
    rows.push([glyph, ICONS[glyph], cells.length])
  }

  for (const [glyph, name, cells] of rows) console.log(`${glyph.padEnd(15)} ${name.padEnd(20)} ${String(cells).padStart(4)} cells @ ${GRID}x${GRID}`)
  console.log(`\n${rows.length} glyphs -> ${OUT}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
