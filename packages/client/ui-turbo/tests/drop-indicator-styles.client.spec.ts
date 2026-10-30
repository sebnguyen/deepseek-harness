/**
 * Turbo offers two ways to make a split — a Session row dragged from the
 * shared sidebar (native DnD, `data-drop` on the tile) and a cell moved by its
 * title bar (react-mosaic's own `.drop-target`). Both must draw one captioned
 * accent half; the library's default black frame on a black wash was nearly
 * invisible on the shell's dark ground. jsdom applies no module CSS, so this
 * pins the selector text.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/TurboGrid.module.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ')

interface Rule {
  readonly selector: string
  readonly body: string
}

const rules: readonly Rule[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
  selector: (match[1] ?? '').trim(),
  body: (match[2] ?? '').trim(),
}))

const NATIVE = '.tile[data-drop]::after'
const LIBRARY = ':global(.mosaic-drop-target .drop-target-container .drop-target)'

/** The one rule that paints both drop affordances. */
function sharedRule(): Rule | undefined {
  return rules.find(rule => rule.selector.includes(NATIVE) && rule.selector.includes(LIBRARY))
}

/** The rule pairing one native half with the same library half under a caption. */
function captionRule(position: string, caption: string): Rule | undefined {
  return rules.find((rule) => {
    const native = `.tile[data-drop='${position}']::after`
    const library = `.drop-target.${position})::after`
    return rule.selector.includes(native) && rule.selector.includes(library) && rule.body.includes(caption)
  })
}

describe('Turbo split-landing indicator', () => {
  it('paints the Session drop and the moved cell with one shared rule', () => {
    const rule = sharedRule()
    expect(rule).toBeDefined()
    expect(rule?.selector).toContain('.canvas')
    expect(rule?.body).toContain('border: 2px solid var(--dsw-alias-state-business-primary)')
    expect(rule?.body).toContain('border-radius: 4px')
    expect(rule?.body).toContain('background: color-mix(in srgb, var(--dsw-alias-label-secondary) 18%, transparent)')
    expect(rule?.body).toContain('text-transform: uppercase')
  })

  it('captions each library edge with the caption the Session drop already uses', () => {
    for (const [position, caption] of [
      ['left', 'Split left'],
      ['right', 'Split right'],
      ['top', 'Split above'],
      ['bottom', 'Split below'],
    ] as const) {
      expect(captionRule(position, caption), position).toBeDefined()
    }
  })

  it('leaves the library its own geometry and paints only the landing indicator', () => {
    const rule = sharedRule()
    expect(rule?.body).not.toMatch(/(?:^|;)\s*(?:inset|top|right|bottom|left|width|height|opacity|z-index):/)
  })
})
