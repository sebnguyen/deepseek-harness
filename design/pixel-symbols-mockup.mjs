// Build the self-contained review page for the shipping pixel-symbol rule:
// one 16x16 grid, rendered only at whole multiples of 16 px. Reads the
// committed design/pixel-symbols/bounded/*.svg, defines every glyph once as a
// <symbol>, and prints the 16/18/32 px proof plus the gap scale.
// Run: node design/pixel-symbols-mockup.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const HERE = import.meta.dirname
const ROOT = join(HERE, 'pixel-symbols')
const OUT = join(HERE, 'pixel-symbols-mockup.html')

const FILES = { add: 'add-bound', adjust: 'adjust-bound', ask: 'Ask-question-bound', attach: 'attatch-bound', bash: 'bash-bounded', check: 'check-bounded', clock: 'clock-bound', close: 'cross-bounded', context: 'context-injection-bounded', copy: 'copy-bound', error: 'error-bound', 'folder-add': 'folder-add', 'folder-close': 'folder-close-bound', 'folder-open': 'folder-open-bound', fork: 'fork-bound', generic: 'generic-tool-bounded', 'image-read': 'image-read-bound', internet: 'Interet-bound', 'model-provider': 'model-provider-bound', 'narrate-mode': 'narrate-mode-bound', pause: 'paude-bound', 'quiet-mode': 'quiet-mode-bound', read: 'read_bounded', reload: 'reload-bound', send: 'Send-bound', setting: 'setting-bound', statistic: 'statistc-bound', think: 'think-bounded', 'thumb-down': 'thump-down-bound', 'thumb-up': 'thump-up-bound', todo: 'to-do-bound', token: 'token-bound', write: 'write_bounded' }

/** The 20% gap as CSS: every full cell is clipped 10% off each side. */
const gapped = (body) => body.replace(/<rect /g, '<rect clip-path="inset(10%)" ')

function bodyOf(svg) {
  return svg.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '')
}

const names = Object.keys(FILES).sort()
const bodies = new Map(names.map((n) => [n, bodyOf(readFileSync(join(ROOT, 'bounded', FILES[n] + '.svg'), 'utf8'))]))

function cellsOf(body) {
  return [...body.matchAll(/<rect x="([\d.]+)" y="([\d.]+)"/g)].map((m) => [Math.round(Number(m[1])), Math.round(Number(m[2]))])
}
const cellsByName = Object.fromEntries(names.map((n) => [n, cellsOf(bodies.get(n))]))

function symbol(name) {
  return `<symbol id="s16-${name}" viewBox="0 0 16 16">${gapped(bodies.get(name))}</symbol>`
}
function glyph(name, size) {
  return `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use href="#s16-${name}"/></svg>`
}
function full(name, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" fill="#0063f8" aria-hidden="true">${gapped(bodies.get(name))}</svg>`
}

// The DigitalOcean mark's stable grid, parsed from the shipped loader module so
// the preview compares against the real 116-cell artwork, which now shares the
// glyphs' full-cell geometry and CSS cell clip.
const loaderSrc = readFileSync(join(HERE, '..', 'packages', 'client', 'ui-primitives', 'src', 'pixel-loader', 'generated.ts'), 'utf8')
const cellsMatch = loaderSrc.match(/PIXEL_LOADER_CELLS:[^=]*=\s*(\[[\s\S]*?\])\s*\n/)
if (!cellsMatch) throw new Error('PIXEL_LOADER_CELLS not found')
const doCells = JSON.parse(cellsMatch[1]).flat()
if (doCells.length < 100) throw new Error(`unexpected DO cell count: ${doCells.length}`)
const doBody = doCells.map(([c, r]) => `<rect x="${c}" y="${r}" width="1" height="1" clip-path="inset(10%)"/>`).join('')

function doGlyph(size) {
  return `<svg class="glyph do-glyph" width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><use href="#do-mark"/></svg>`
}

const gallery = names.map((n) => `<div class="cell">${glyph(n, 64)}<span class="name">${n}</span></div>`).join('')
const gallery16 = names.map((n) => `<div class="cell">${glyph(n, 16)}<span class="name">${n}</span></div>`).join('')
const darkGallery = names.map((n) => `<div class="cell dark-cell">${glyph(n, 32)}</div>`).join('')
const ladder = ['read', 'bash', 'error', 'send'].map((n) => `<div class="ladder-row"><span class="row-name">${n}</span>${[16, 32, 48, 64, 96, 128].map((s) => `<div class="step">${glyph(n, s)}<small>${s}px</small><small class="gap">${(s / 16 * 0.20).toFixed(2)}px gap</small></div>`).join('')}</div>`).join('')
const gapCards = [
  [32, '32px', '2px cell · 0.40px gap'],
  [48, '48px', '3px cell · 0.60px gap'],
  [64, '64px', '4px cell · 0.80px gap'],
  [96, '96px', '6px cell · 1.20px gap'],
].map(([size, label, note]) => `<div class="gap-card">${glyph('read', size)}<b>16 grid · ${label}</b><span>${note}</span></div>`).join('')

const doPairs = [16, 64, 96].map((s) => `<div class="do-pair">
  <div class="do-card">${doGlyph(s)}<b>DO mark · ${s}px</b><span>${s / 16}px cell · full cell · CSS clip</span></div>
  <div class="do-card">${glyph('read', s)}<b>read · ${s}px</b><span>${s / 16}px cell · ${(s / 16 * 0.20).toFixed(2)}px gap · CSS clip</span></div>
</div>`).join('')

const TUNER_SIZES = [16, 32, 48, 64, 80, 96, 112, 128]
const tunerMark = (id, size, label) => `<div class="tuner-mark"><svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="#0063f8" aria-label="${label}"><use href="#${id}"/></svg><span>${label}</span></div>`
const tunerBlocks = TUNER_SIZES.map((s) => `<div class="tuner-block"><div class="tuner-block-head"><b>${s}px</b><span id="tuner-block-gap-${s}">${(0.20 * s / 16).toFixed(2)}px gap · ${s / 16}px cell</span></div><div class="tuner-grid" style="--ts:${s}px">${tunerMark('t-do', s, 'logo')}${names.map((n) => tunerMark('t16-' + n, s, n)).join('')}</div></div>`).join('')

const demo = (size, label, tone, note) => `<div class="demo ${tone}" data-raster="${size}">
  <div class="native">${full('read', size)}</div>
  <canvas width="${size}" height="${size}" aria-label="${label} magnified"></canvas>
  <div class="demo-label"><b>${label}</b><span>${note}</span></div>
</div>`

const html = `<!doctype html>
<!-- Review page for the shipping pixel-symbol rule: one 16x16 grid, rendered
     only at whole multiples of 16 px. Regenerate with
     node design/pixel-symbols-mockup.mjs. Self-contained, no network. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pixel symbols — 16×16 grid at ×16 sizes</title>
<style>
  :root { color-scheme: light; font-family: system-ui, sans-serif; }
  body { margin: 0; background: #eef0f4; color: #000c2a; }
  .stage { display: flex; flex-direction: column; gap: 34px; padding: 34px 40px 64px; max-width: 1120px; margin: 0 auto; }
  header { display: flex; flex-direction: column; gap: 8px; }
  .eyebrow { font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #5d6c6c; }
  h1 { font-size: 22px; line-height: 1.2; margin: 0; letter-spacing: -.01em; }
  h2 { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #5d6c6c; margin: 0; }
  .lede { margin: 0; max-width: 76ch; font-size: 13.5px; line-height: 1.6; color: #5d6c6c; }
  .lede code, p.note code { font: 12px/1.4 ui-monospace, monospace; color: #000c2a; background: #fff; border: 1px solid #dfe4ec; border-radius: 4px; padding: 1px 4px; }
  section { display: flex; flex-direction: column; gap: 12px; }
  .hint { margin: 0; font-size: 12px; line-height: 1.55; color: #5d6c6c; }
  .demos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .demo { display: flex; flex-direction: column; align-items: center; gap: 10px; border: 1px solid #dfe4ec; border-radius: 10px; background: #fff; padding: 14px 12px; }
  .demo.good { border-color: #9fd9bd; background: linear-gradient(#fff, #f5fcf8); }
  .demo.bad { border-color: #f0b6bd; background: linear-gradient(#fff, #fff6f7); }
  .demo canvas { width: 200px; height: 200px; image-rendering: pixelated; border: 1px solid #e8ecf2; border-radius: 4px; background: #fff; }
  .native { height: 24px; display: grid; place-items: center; }
  .demo-label { display: flex; flex-direction: column; gap: 2px; align-items: center; text-align: center; }
  .demo-label b { font: 700 11px/1.3 ui-monospace, monospace; }
  .demo-label span { font: 10px/1.3 ui-monospace, monospace; color: #5d6c6c; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); gap: 10px; }
  .gallery-16 { grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 8px; }
  .gallery-16 .cell { min-height: 58px; gap: 6px; padding: 8px 4px; }
  .gallery-16 .name { font-size: 8.5px; line-height: 1.15; text-align: center; white-space: normal; }
  .cell { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 96px; border: 1px solid #dfe4ec; border-radius: 8px; background: #fff; padding: 12px 6px; }
  .cell .name { font: 10px/1.2 ui-monospace, monospace; color: #5d6c6c; white-space: nowrap; }
  .dark-panel { background: #121618; border: 1px solid rgb(255 255 255 / 12%); border-radius: 12px; padding: 18px; }
  .dark-panel .gallery { grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 6px; }
  .dark-cell { min-height: 62px; border-color: rgb(255 255 255 / 10%); background: transparent; padding: 8px 4px; }
  .dark-panel .glyph { color: #7bb4bc; }
  .do-pairs { display: flex; flex-direction: column; gap: 14px; }
  .do-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .do-card { display: flex; flex-direction: column; align-items: center; gap: 8px; border: 1px solid #dfe4ec; border-radius: 10px; background: #fff; padding: 18px 12px; }
  .do-card b { font: 700 10.5px/1.3 ui-monospace, monospace; }
  .do-card span { font: 10px/1.3 ui-monospace, monospace; color: #5d6c6c; }
  .do-glyph { color: #0063f8; }
  .tuner { display: flex; flex-direction: column; gap: 16px; border: 1px solid #dfe4ec; border-radius: 12px; background: #fff; padding: 18px; }
  .tuner-controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .tuner-controls label { display: flex; align-items: center; gap: 8px; font: 700 11px/1.2 ui-monospace, monospace; }
  .tuner-controls input[type=range] { flex: 1 1 240px; accent-color: #0063f8; }
  .tuner-note { font: 10px/1.3 ui-monospace, monospace; color: #5d6c6c; }
  .tuner-stage { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  .tuner-card { display: flex; flex-direction: column; align-items: center; gap: 8px; border: 1px solid #eef1f5; border-radius: 10px; padding: 18px 12px; }
  .tuner-card b { font: 700 10.5px/1.3 ui-monospace, monospace; }
  .tuner-card span { font: 10px/1.3 ui-monospace, monospace; color: #5d6c6c; }
  .tuner-blocks { display: flex; flex-direction: column; gap: 24px; }
  .tuner-block { display: flex; flex-direction: column; gap: 10px; border-top: 1px solid #eef1f5; padding-top: 14px; }
  .tuner-block-head { display: flex; align-items: baseline; gap: 10px; }
  .tuner-block-head b { font: 700 11px/1.2 ui-monospace, monospace; }
  .tuner-block-head span { font: 10px/1.2 ui-monospace, monospace; color: #5d6c6c; }
  .tuner-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(var(--ts) + 30px), 1fr)); gap: 10px; align-items: start; }
  .tuner-mark { display: flex; flex-direction: column; align-items: center; gap: 5px; }
  .tuner-mark svg { color: #0063f8; }
  .tuner-mark span { font: 8px/1.1 ui-monospace, monospace; color: #5d6c6c; text-align: center; overflow-wrap: anywhere; }
  .gap-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .gap-card { display: flex; flex-direction: column; align-items: center; gap: 8px; border: 1px solid #dfe4ec; border-radius: 10px; background: #fff; padding: 18px 12px; }
  .gap-card b { font: 700 10.5px/1.3 ui-monospace, monospace; }
  .gap-card span { font: 10px/1.3 ui-monospace, monospace; color: #5d6c6c; }
  .ladder { display: flex; flex-direction: column; gap: 2px; border: 1px solid #dfe4ec; border-radius: 10px; background: #fff; padding: 10px 14px; }
  .ladder-row { display: grid; grid-template-columns: 90px repeat(6, 1fr); align-items: end; gap: 8px; padding: 10px 0; border-bottom: 1px solid #eef1f5; }
  .ladder-row:last-child { border-bottom: 0; }
  .row-name { font: 700 11px/1.2 ui-monospace, monospace; align-self: center; }
  .step { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .step small { font: 9.5px/1.2 ui-monospace, monospace; color: #5d6c6c; }
  .step .gap { color: #919f9e; font-size: 8.5px; }
  .glyph { display: block; color: #0063f8; }
  p.note { margin: 0; font-size: 12px; line-height: 1.65; color: #5d6c6c; }
  @media (max-width: 820px) { .demos, .gap-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } .stage { padding: 24px 18px 48px; } }
</style>
</head>
<body>
<div class="stage">
  <header>
    <div class="eyebrow">Pixel symbols · one 16×16 grid</div>
    <h1>Render at whole multiples of 16px</h1>
    <p class="lede">The grid is fixed at 16×16. 16, 32, 48, 64, 96 and 128 px all divide it into whole pixels; 18 px does not (1.125 px per cell), which is the softness the old chat mark had. The gap is 20% of each cell, applied by CSS (a 10% inset clip per side) on full-cell rects, so the artwork stays one 1×1 rect per lit cell.</p>
  </header>

  <section>
    <h2>Why 18px looked soft</h2>
    <p class="hint">The same <b>read</b> mark, rasterized at its real pixel size and magnified with nearest-neighbour. Only whole multiples land every cell on a whole pixel.</p>
    <div class="demos">
      ${demo(16, '16 grid · 16px', 'good', '1px / cell — crisp')}
      ${demo(18, '16 grid · 18px', 'bad', '1.125px / cell — the old chat mark')}
      ${demo(32, '16 grid · 32px', 'good', '2px / cell — crisp')}
    </div>
  </section>

  <section>
    <h2>All 33 glyphs · 64px</h2>
    <p class="hint">4px cells, 0.80px gaps — every glyph is the same 16×16 grid.</p>
    <div class="gallery">${gallery}</div>
  </section>

  <section>
    <h2>All 33 glyphs · 16px</h2>
    <p class="hint">1px cells, 0.20px gaps — the shipping chat size, no magnification.</p>
    <div class="gallery gallery-16">${gallery16}</div>
  </section>

  <section>
    <h2>All 33 glyphs on dark · 32px</h2>
    <p class="hint">Same 33 glyphs, same order as the light gallery. 2px cells.</p>
    <div class="dark-panel"><div class="gallery">${darkGallery}</div></div>
  </section>

  <section>
    <h2>DO mark vs header mark</h2>
    <p class="hint">Both the DO mark and the header symbols are full-cell 1×1 rects with the 20% gap in CSS, so neither carries an inset or a radius; the only difference is the cells each artwork lights.</p>
    <div class="do-pairs">${doPairs}</div>
  </section>

  <section>
    <h2>Gap tuner</h2>
    <p class="hint">Drag the gap. 20% is the shipped default; 0% merges the cells, 40% turns them into a screen door. The two previews are 128px; below, <b>read</b> is rendered at every ×16 size from 16 to 128.</p>
    <div class="tuner">
      <div class="tuner-controls">
        <label for="gap">Gap <b id="gap-readout">20%</b></label>
        <input id="gap" type="range" min="0" max="40" step="1" value="20">
        <div class="tuner-note" id="gap-note">1.60px at 128px · 0.80px at 64px</div>
      </div>
      <div class="tuner-stage">
        <div class="tuner-card"><svg id="tuner-do" width="128" height="128" viewBox="0 0 16 16" fill="#0063f8" aria-label="DO mark at the selected gap"><use href="#t-do"/></svg><b>DO mark · 128px</b><span>full cell · CSS clip</span></div>
        <div class="tuner-card"><svg id="tuner-read" width="128" height="128" viewBox="0 0 16 16" fill="#0063f8" aria-label="read at the selected gap"><use href="#t16-read"/></svg><b>read · 128px</b><span>full cell · CSS clip</span></div>
      </div>
      <div class="tuner-blocks">${tunerBlocks}</div>
    </div>
  </section>

  <section>
    <h2>Gap scale — 20% of every cell</h2>
    <p class="hint">Each cell is a full 1×1 rect and CSS clips 10% off every side, so the gap is a constant fraction of the cell and grows with the render size instead of being re-tuned per size.</p>
    <div class="gap-row">${gapCards}</div>
  </section>

  <section>
    <h2>Size ladder · only ×16 sizes</h2>
    <div class="ladder">${ladder}</div>
  </section>

  <p class="note">Shipping rule: the 16×16 grid, rendered at 16/32/48/64/96/128 px. The chat mark uses 16 px; 18 px was the outlier. The 32×32 derivation in <code>bounded32/</code> is archived, not the shipping path. Rebuild this page with <code>node design/pixel-symbols-mockup.mjs</code>.</p>
</div>

<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${names.map((n) => symbol(n)).join('')}<symbol id="do-mark" viewBox="0 0 16 16">${doBody}</symbol>${names.map((n) => `<symbol id="t16-${n}" viewBox="0 0 16 16">${gapped(bodies.get(n))}</symbol>`).join('')}<symbol id="t-do" viewBox="0 0 16 16">${doBody}</symbol></defs></svg>
<script>
  for (const card of document.querySelectorAll('[data-raster]')) {
    const svg = card.querySelector('svg')
    const size = Number(card.dataset.raster)
    const canvas = card.querySelector('canvas')
    const image = new Image()
    image.onload = () => {
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      context.clearRect(0, 0, size, size)
      context.drawImage(image, 0, 0, size, size)
    }
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg))
  }

  const GAP_CELLS = ${JSON.stringify(cellsByName)};
  const GAP_DO = ${JSON.stringify(doCells)};
  const TUNER_NAMES = ${JSON.stringify(names)};
  const TUNER_SIZES = ${JSON.stringify(TUNER_SIZES)};

  function clipRects(cells, gap) {
    let out = ''
    const inset = (gap / 2).toFixed(2)
    for (let i = 0; i < cells.length; i++) {
      out += '<rect x="' + cells[i][0] + '" y="' + cells[i][1] + '" width="1" height="1" clip-path="inset(' + inset + '%)"/>'
    }
    return out
  }
  function renderGap(gap) {
    document.getElementById('t-do').innerHTML = clipRects(GAP_DO, gap)
    for (let i = 0; i < TUNER_NAMES.length; i++) {
      const n = TUNER_NAMES[i]
      document.getElementById('t16-' + n).innerHTML = clipRects(GAP_CELLS[n], gap)
    }
    for (let i = 0; i < TUNER_SIZES.length; i++) {
      const s = TUNER_SIZES[i]
      document.getElementById('tuner-block-gap-' + s).textContent = (gap / 100 * s / 16).toFixed(2) + 'px gap · ' + (s / 16) + 'px cell'
    }
    document.getElementById('gap-readout').textContent = gap + '%'
    document.getElementById('gap-note').textContent = (gap / 100 * 8).toFixed(2) + 'px at 128px · ' + (gap / 100 * 4).toFixed(2) + 'px at 64px'
  }
  const gapSlider = document.getElementById('gap')
  gapSlider.addEventListener('input', function () { renderGap(Number(gapSlider.value)) })
  renderGap(Number(gapSlider.value))
</script>
</body>
</html>
`

writeFileSync(OUT, html)
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(1)} kB, ${names.length} glyphs)`)
