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
