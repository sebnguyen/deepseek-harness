// @vitest-environment jsdom

import { writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import {
  PceRow, PIXEL_SYMBOLS, PixelGlyph, type PceKind, type PixelSymbolName,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** The catalog glyph each pce node kind uses in the ported UI. */
const KIND_GLYPH: Record<PceKind, PixelSymbolName> = {
  user: 'send',
  'goal-input': 'send',
  assistant: 'model-provider',
  steering: 'narrate-mode',
  context: 'context',
  'system-prompt': 'setting',
  reasoning: 'think',
  'tool-generic': 'generic',
  read: 'read',
  'file-mutation': 'write',
  bash: 'bash',
  search: 'internet',
  web: 'internet',
  todo: 'todo',
  ask: 'ask',
  'read-image': 'image-read',
  subcalls: 'fork',
  'workflow-run': 'fork',
  command: 'adjust',
  'manual-compaction': 'copy',
  compaction: 'folder-close',
  retry: 'reload',
  'turn-error': 'error',
  'max-tokens': 'token',
  'turn-tail': 'statistic',
  unknown: 'add',
  'step-boundary': 'pause',
  inbox: 'folder-open',
}

/** The six affordance glyphs plus the two extra catalog symbols. */
const AFFORDANCE_GLYPHS: readonly PixelSymbolName[] = [
  'attach', 'clock', 'folder-add', 'quiet-mode', 'thumb-up', 'thumb-down', 'check', 'close',
]

describe('pce glyph coverage', () => {
  afterEach(cleanup)

  it('renders every catalog symbol once across the pce kinds and affordances', () => {
    const view = render(
      <div>
        {(Object.entries(KIND_GLYPH) as [PceKind, PixelSymbolName][]).map(([kind, glyph]) => (
          <PceRow
            key={kind}
            kind={kind}
            glyph={glyph}
            title={kind}
            state="ok"
            collapsible={false}
            body={<span>{kind} body</span>}
          />
        ))}
        {AFFORDANCE_GLYPHS.map(name => <PixelGlyph key={name} name={name} size={16} />)}
      </div>,
    )
    // The mark cell is 16px; a glyph that asks for another edge would be the
    // one oversized svg in the row (the stylesheet clamp is not the contract).
    for (const mark of view.container.querySelectorAll('.pce-mark svg')) {
      expect(mark.getAttribute('width'), 'mark glyph width').toBe('16')
      expect(mark.getAttribute('height'), 'mark glyph height').toBe('16')
    }
    // Geometry is full-cell: every lit cell is a 1x1 rect at integer coordinates
    // inside the 16-grid, and the gap is CSS rather than artwork. Reload used to
    // carry its own inset guard here because the old artwork was full-bleed; the
    // shipped cell set is now derived on that same grid, so the rule is checked
    // for every symbol instead.
    for (const [name, symbol] of Object.entries(PIXEL_SYMBOLS)) {
      const rects = new DOMParser()
        .parseFromString(`<svg>${symbol.body}</svg>`, 'image/svg+xml')
        .querySelectorAll('rect')
      expect(rects.length, `${name} has cells`).toBeGreaterThan(0)
      for (const rect of rects) {
        const x = Number(rect.getAttribute('x'))
        const y = Number(rect.getAttribute('y'))
        expect(Number.isInteger(x) && Number.isInteger(y), `${name} cell ${x},${y} sits on the grid`).toBe(true)
        expect(x, `${name} cell x`).toBeGreaterThanOrEqual(0)
        expect(x, `${name} cell x`).toBeLessThanOrEqual(15)
        expect(y, `${name} cell y`).toBeGreaterThanOrEqual(0)
        expect(y, `${name} cell y`).toBeLessThanOrEqual(15)
        expect(rect.getAttribute('width'), `${name} cell width`).toBe('1')
        expect(rect.getAttribute('height'), `${name} cell height`).toBe('1')
        expect(rect.getAttribute('rx'), `${name} has no baked radius`).toBeNull()
      }
    }
    const found = new Set(
      [...view.container.querySelectorAll('[data-glyph]')].map(node => node.getAttribute('data-glyph')),
    )
    const expected = new Set<string>([...Object.values(KIND_GLYPH), ...AFFORDANCE_GLYPHS])
    for (const name of expected) expect(found.has(name), `missing glyph ${name}`).toBe(true)
    expect(expected.size).toBe(Object.keys(PIXEL_SYMBOLS).length)
    expect(found.size).toBe(expected.size)
    writeFileSync('/tmp/pce-glyph-dom.html', view.container.innerHTML)
  })
})
