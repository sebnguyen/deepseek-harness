// Single source for the pixelized DigitalOcean loading symbol:
//   design/pixel-do-loader.svg           standalone 24-grid mark (review asset)
//   design/pixel-do-loader-16.svg        standalone 16-grid mark (review asset)
//   design/pixel-do-loader-mockup.html   live review page
//   packages/client/ui-primitives/src/pixel-loader/generated.ts   shared cells + css
//   apps/desktop/renderer/spinner.svg  inline SMIL fragment for the desktop splash
// Regenerate everything after changing recipe knobs:  node design/pixel-do-loader-gen.mjs
//
// The web sweep is a CSS animation: each 22.5-degree bucket of pixels is one
// <g class="dsh-pl">. Every bucket's animation-delay carries its own clockwise
// stagger (-k/16 of the cycle) added to the host-shifted sweep window
// (--dsh-boot-arc / --dsh-pixel-loader-boost), so the ladder runs around the
// mark instead of blinking in unison. The shared stylesheet ships once per
// document; bodies carry geometry only. Rendered pitch widens the pixel gap: at
// a 1:1 cell pitch the gap is the locked 30%, and smaller renderings trade
// pixel mass for gap until 50% so the mark survives sub-1px cells. The desktop
// startup splash instead carries the SMIL twin (begin offsets) inside a div
// because its CSP (style-src 'self') forbids inline style elements/attributes.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const GRID24 = [
  '.........#######........',
  '......############......',
  '.....##############.....',
  '....#################...',
  '...##################...',
  '..#######......#######..',
  '.######..........######.',
  '.#####............#####.',
  '######............######',
  '#####..............#####',
  '#####..............#####',
  '#####..............#####',
  '...................#####',
  '...................#####',
  '...................#####',
  '.......#####......#####.',
  '.###...#####......#####.',
  '.###...#####.....######.',
  '.###...#####...#######..',
  '....###.....#########...',
  '....###.....########....',
  '....###.....#######.....',
  '....###.....######......',
  '............###.........',
]
const GRID16 = [
  '.....######.....',
  '...##########...',
  '..############..',
  '.#####....#####.',
  '.####.......###.',
  '####........####',
  '###..........###',
  '###..........###',
  '.............###',
  '.............###',
  '.....###....####',
  '.##..###...####.',
  '.##..###..#####.',
  '...##...######..',
  '...##...#####...',
  '........###.....',
]

// Sweep recipe: F buckets of one shared cycle; each bucket's pixels pop to full
// color when the hand reaches them and decay down the ladder behind it.
// The step order is the clockwise bucket index (12 o'clock first), matching the approved mock: the light runs around the mark.
const F = 16
const PERIOD = 1.2
const DIM = 0.22
const LADDER = [1, 0.87, 0.74, 0.61, 0.48, 0.35, DIM]
// Per-cell inset at the locked 30% gap (a 0.7 cell in a 1-unit pitch).
const INSET = 0.15

const ROOT = '/home/snguyen/dev/digitalocean/idk/deepseek-harness'
const DESIGN = `${ROOT}/design`
const MODULE_OUT = `${ROOT}/packages/client/ui-primitives/src/pixel-loader/generated.ts`
const DESKTOP_OUT = `${ROOT}/apps/desktop/renderer/spinner.svg`

function round2(n) { return Math.round(n * 100) / 100 }


/** Bucket the minted grid into F clockwise sweep groups of [col,row] cells. */
function bucketsFor(rows) {
  const N = rows.length
  const groups = Array.from({ length: F }, () => [])
  rows.forEach((line, r) => {
    for (let c = 0; c < N; c += 1) {
      if (line[c] !== '#') continue
      const angle = Math.atan2(r + 0.5 - N / 2, c + 0.5 - N / 2) * 180 / Math.PI
      const f = ((((angle + 90) % 360) + 360) % 360) / 360
      groups[Math.round(f * F) % F].push([c, r])
    }
  })
  return groups
}

function rectsFor(cells, inset, rx) {
  const side = round2(1 - 2 * inset)
  return cells.map(([c, r]) =>
    `<rect x="${round2(c + inset)}" y="${round2(r + inset)}" width="${side}" height="${side}" rx="${rx}"/>`).join('')
}

/** The sweep stylesheet shared by every document host. */
function styleBlock() {
  const steps = LADDER.map((value, i) => `${round2((i / F) * 100)}%{opacity:${value}}`).join('')
  return `.dsh-pl{animation:dsh-pl-sweep ${PERIOD}s step-end infinite}
@keyframes dsh-pl-sweep{${steps}100%{opacity:${DIM}}}
@media (prefers-reduced-motion: reduce){.dsh-pl{animation:none}}`
}

/** CSS mode: per-bucket clockwise delays, shiftable through custom properties. */
function innerCss(cells, inset, rx) {
  return cells.map((bucket, k) => {
    const begin = round2((k / F) * PERIOD)
    const delay = `calc(${begin}s + (var(--dsh-boot-arc, 72deg) - var(--dsh-pixel-loader-boost, 0) * 360deg) / 360deg * ${PERIOD}s)`
    return `<g opacity="${DIM}" class="dsh-pl" style="animation-delay: ${delay}">${rectsFor(bucket, inset, rx)}</g>`
  }).join('')
}

/** SMIL mode: same clockwise order through begin offsets, no styles at all. */
function innerSmil(cells, inset, rx) {
  const keyTimes = LADDER.map((_, i) => round2(i / F)).join(';')
  const values = LADDER.join(';')
  return cells.map((bucket, k) => {
    const begin = round2((k / F) * PERIOD)
    return `<g opacity="${DIM}"><animate attributeName="opacity" calcMode="discrete" values="${values}" keyTimes="${keyTimes}" dur="${PERIOD}s" begin="${begin}s" repeatCount="indefinite"/>${rectsFor(bucket, inset, rx)}</g>`
  }).join('')
}

function svgFor(cells, { rx, width }) {
  const N = cellsWidth(cells)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" width="${width}" height="${width}" fill="currentColor" aria-hidden="true">
<style>
${styleBlock()}
</style>
${innerCss(cells, INSET, rx)}
</svg>
`
}
function cellsWidth(cells) {
  let max = 0
  for (const bucket of cells) for (const [c, r] of bucket) max = Math.max(max, c, r)
  return max + 1
}

const CSS = styleBlock()
const cells24 = bucketsFor(GRID24)
const cells16 = bucketsFor(GRID16)
const big = svgFor(cells24, { rx: 0.18, width: 48 })
const small = svgFor(cells16, { rx: 0.12, width: 16 })
writeFileSync(`${DESIGN}/pixel-do-loader.svg`, big)
writeFileSync(`${DESIGN}/pixel-do-loader-16.svg`, small)

mkdirSync(dirname(MODULE_OUT), { recursive: true })
writeFileSync(MODULE_OUT, `/**
 * Generated by \`node design/pixel-do-loader-gen.mjs\` — do not edit by hand.
 * Clockwise sweep buckets of the pixelized DigitalOcean loading mark as
 * [column,row] cells: {@link PIXEL_LOADER_CELLS_24} on the coverage-minted
 * 24x24 grid and {@link PIXEL_LOADER_CELLS_16} on the coarser 16x16 grid. The
 * clockwise order lights the buckets 12-o'clock-first. Renderers turn buckets into
 * rect markup (see ui-primitives PixelLoader): one \`<g class="dsh-pl">\` per
 * bucket, its \`animation-delay\` the bucket's step plus the host-shifted
 * sweep window; the shared stylesheet
 * {@link PIXEL_LOADER_CSS} carries the step-end ladder and the
 * prefers-reduced-motion guard once per document.
 */

/** One full sweep cycle, in seconds; every delay math follows it. */
export const PIXEL_LOADER_PERIOD_S = ${PERIOD}

/** Shared sweep stylesheet: discrete opacity ladder + reduced-motion guard. */
export const PIXEL_LOADER_CSS = \`${CSS}\`

/** 24x24 grid buckets: deep-diving, boot page, and 20px-and-up chrome. */
export const PIXEL_LOADER_CELLS_24: readonly (readonly (readonly [number, number])[])[] = ${JSON.stringify(cells24)}


/** 16x16 grid buckets: sidebar/picker/timeline small-chrome loading. */
export const PIXEL_LOADER_CELLS_16: readonly (readonly (readonly [number, number])[])[] = ${JSON.stringify(cells16)}

`)

// The splash script toggles #spinner via hidden, an HTMLElement-only idiom,
// so the SMIL svg rides inside a div.
writeFileSync(DESKTOP_OUT, `<div id="spinner" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
${innerSmil(cells24, INSET, 0.18)}
</svg></div>
`)

// mock page: embed both full svgs as templates, clone at the sizes under review
function elided(svg) { return svg.trim().replace(' aria-hidden="true"', '').replace(/ width="\d+" height="\d+"/, '') }
const mock = `<!doctype html>
<!-- Live review page for the pixelized DigitalOcean loading symbol. Regenerate
     with \`node design/pixel-do-loader-gen.mjs\`; the inline bodies below match
     packages/client/ui-primitives/src/pixel-loader/generated.ts. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mock — pixel DigitalOcean loader (staggered CSS sweep)</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; background: #eef0f4; color: #000c2a; }
  .stage { display: flex; flex-direction: column; gap: 28px; padding: 32px 40px; max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0; }
  section { display: flex; flex-direction: column; gap: 12px; }
  h2 { font-size: 13px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #5d6c6c; margin: 0; }
  .row { display: flex; gap: 24px; align-items: stretch; flex-wrap: wrap; }
  .panel { border-radius: 14px; padding: 28px 36px; display: flex; align-items: center; justify-content: center; border: 1px solid rgb(0 12 42 / 10%); }
  .panel.light { background: #fff; }
  .panel.dark { background: #121618; border-color: rgb(255 255 255 / 12%); }
  .boot-card { display: flex; flex-direction: column; align-items: center; gap: 16px; }
  .wordmark { font-size: 16px; line-height: 24px; font-weight: 600; letter-spacing: 0.08em; color: #000c2a; }
  .hint { font-size: 12px; line-height: 18px; color: #919f9e; }
  .dark .wordmark { color: #f7f8f8; }
  .frames { display: flex; gap: 20px; align-items: end; }
  .frame { display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .frame small { color: #5d6c6c; font-size: 11px; }
  .dark .frame small { color: #919f9e; }
  p.note { font-size: 13px; line-height: 1.6; color: #5d6c6c; }
  .panel.light svg { color: #0063f8; }
  .panel.dark svg { color: #7bb4bc; }
</style>
</head>
<body>
<div class="stage">
  <h1>Boot loading symbol — staggered pixel sweep</h1>

  <section>
    <h2>24x24 mark at boot sizes, light / dark</h2>
    <div class="row">
      <div class="panel light"><div class="boot-card">
        <div class="wordmark">HARNESS</div>
        <div class="frames">
          <div class="frame"><span data-slot="24" data-size="24"></span><small>24px</small></div>
          <div class="frame"><span data-slot="24" data-size="32"></span><small>32px</small></div>
          <div class="frame"><span data-slot="24" data-size="48"></span><small>48px</small></div>
        </div>
        <div class="hint">Loading plugins…</div>
      </div></div>
      <div class="panel dark"><div class="boot-card">
        <div class="wordmark">HARNESS</div>
        <div class="frames">
          <div class="frame"><span data-slot="24" data-size="24"></span><small>24px</small></div>
          <div class="frame"><span data-slot="24" data-size="32"></span><small>32px</small></div>
          <div class="frame"><span data-slot="24" data-size="48"></span><small>48px</small></div>
        </div>
        <div class="hint">Loading plugins…</div>
      </div></div>
    </div>
  </section>

  <section>
    <h2>16x16 mark for small chrome, light / dark</h2>
    <div class="row">
      <div class="panel light"><div class="boot-card">
        <div class="frames">
          <div class="frame"><span data-slot="16" data-size="16"></span><small>16px</small></div>
          <div class="frame"><span data-slot="16" data-size="12"></span><small>12px</small></div>
          <div class="frame"><span data-slot="16" data-size="96"></span><small>magnified</small></div>
        </div>
      </div></div>
      <div class="panel dark"><div class="boot-card">
        <div class="frames">
          <div class="frame"><span data-slot="16" data-size="16"></span><small>16px</small></div>
          <div class="frame"><span data-slot="16" data-size="12"></span><small>12px</small></div>
          <div class="frame"><span data-slot="16" data-size="96"></span><small>magnified</small></div>
        </div>
      </div></div>
    </div>
  </section>

  <section>
    <h2>Magnified, live</h2>
    <div class="row">
      <div class="panel light"><span data-slot="24" data-size="168"></span></div>
      <div class="panel dark"><span data-slot="24" data-size="168"></span></div>
    </div>
  </section>

  <p class="note">
    Each of the 16 bucket groups carries its own clockwise stagger on the
    shared step-end ladder (1.2s), so the light runs around the mark starting
    at 12 o'clock. Rects are inset 0.15 per cell (30% gaps) at 1:1 pitch;
    renderers widen the gap toward 50% as the pitch drops below 1px.
    <code>fill="currentColor"</code> themes light/dark from CSS color.
  </p>
</div>

<template id="tpl-24">${elided(big)}</template>
<template id="tpl-16">${elided(small)}</template>

<script>
  for (const slot of document.querySelectorAll('[data-slot]')) {
    const node = document.getElementById('tpl-' + slot.getAttribute('data-slot')).content.firstElementChild.cloneNode(true)
    node.setAttribute('width', slot.getAttribute('data-size'))
    node.setAttribute('height', slot.getAttribute('data-size'))
    slot.append(node)
  }
</script>
</body>
</html>
`
writeFileSync(`${DESIGN}/pixel-do-loader-mockup.html`, mock)
console.log('svg24:', big.length, 'B; svg16:', small.length, 'B; mock:', mock.length, 'B')
