/**
 * Dormant row-window shells must stay in flow. In the new design, there is no
 * IntersectionObserver and no `data-row-dormant` marker. Declined rows collapse
 * via `display: none` on `.flowItem:empty` / `:has(> *:only-child:empty)`.
 * Dormant rows are not declined rows — they render a spacer div, so they are
 * not `:empty` and not `:has(> *:only-child:empty)` (the spacer has a height).
 * jsdom applies no module CSS, so this pins the selector text.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readChat = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/chat/${name}`, import.meta.url)), 'utf8')

const css = readChat('ChatView.module.css').replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('chat row-window dormant shells', () => {
  it('collapses declined (empty) rows but never a dormant spacer', () => {
    const rule = /(?:^|[{}])\s*([^{}]*:has\(> \*:only-child:empty[^{}]*)\{([^{}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    expect(rule?.[1]).toContain(':not([data-chat-flow-spacer])')
    expect(rule?.[2]).toMatch(/display:\s*none/)
  })

  it('dormant rows render a measured spacer in flow', () => {
    expect(readChat('ChatNodeSeat.tsx')).toContain('data-chat-flow-spacer')
  })

  it('spaces flow rows with one container gap, not per-row margins', () => {
    const column = /(?:^|[{}])\s*(\.column\s*\{[^}]*)\}/.exec(css)
    expect(column?.[1]).toMatch(/gap:\s*8px/)
    expect(css).not.toMatch(/\.column\s*>\s*\*\s*\{[^}]*margin-bottom/)
  })

  it('does not use data-row-dormant marker (removed in redesign)', () => {
    expect(readChat('ChatNodeSeat.tsx')).not.toContain('data-row-dormant')
  })
})
