/**
 * Dormant flow-row shells must stay in flow. There is no IntersectionObserver
 * and no `data-row-dormant` marker. Declined rows collapse via `display: none`
 * on `.flowItem:empty` / `:has(> *:only-child:empty)`. Dormant rows are not
 * declined rows — they render a spacer div, so they are not `:empty` and not
 * `:has(> *:only-child:empty)` (the spacer has a height).
 * jsdom applies no module CSS, so this pins the selector text.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readChat = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/chat/${name}`, import.meta.url)), 'utf8')

const css = readChat('ChatView.module.css').replace(/\/\*[\s\S]*?\*\//g, ' ')
const atlas = readFileSync(
  fileURLToPath(new URL('../../../../apps/web/public/atlas.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ')
const motion = readFileSync(
  fileURLToPath(new URL('../../ui-primitives/src/motion.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('chat flow-row dormant shells', () => {
  it('collapses declined (empty) rows but never a dormant spacer', () => {
    const rule = /(?:^|[{}])\s*([^{}]*:has\(> \*:only-child:empty[^{}]*)\{([^{}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    expect(rule?.[1]).toContain(':not([data-chat-flow-spacer])')
    expect(rule?.[2]).toMatch(/display:\s*none/)
  })

  it('dormant rows render a measured spacer in flow', () => {
    expect(readChat('ChatNodeSeat.tsx')).toContain('data-chat-flow-spacer')
  })

  it('suppresses the arrival rise for a row the band woke', () => {
    // Dormancy re-mounts rows in bulk behind the reader; replaying the rise
    // there spends the animation budget on rows nobody is looking at.
    expect(readChat('ChatNodeSeat.tsx')).toContain('data-chat-flow-woke')
    const wokeRule = /([^{}]*\[data-chat-flow-woke\][^{}]*)\{([^{}]*)\}/.exec(atlas)
    expect(wokeRule).not.toBeNull()
    expect(wokeRule?.[2]).toMatch(/animation:\s*none/)

    // Every arrival site must be covered. The theme documents four: a pce row,
    // an answer's blocks, the characters an answer reveals, and the tail. A
    // fifth site has to add itself here and to the woke rule together.
    const sites = ['.pce', "[class*='_body'] > *", '[data-tail]', "[data-chat-flow-kind='turn-tail']"]
    for (const site of sites) expect(wokeRule?.[1]).toContain(site)
    const arrivals = [...atlas.matchAll(/animation:\s*surf-up/g), ...motion.matchAll(/animation:\s*surf-up/g)]
    expect(arrivals).toHaveLength(sites.length)
  })

  it('spaces flow rows with one container gap, not per-row margins', () => {
    const column = /(?:^|[{}])\s*(\.column\s*\{[^}]*)\}/.exec(css)
    expect(column?.[1]).toMatch(/gap:\s*6px/)
    expect(css).not.toMatch(/\.column\s*>\s*\*\s*\{[^}]*margin-bottom/)
  })

  it('does not use data-row-dormant marker (removed in redesign)', () => {
    expect(readChat('ChatNodeSeat.tsx')).not.toContain('data-row-dormant')
  })

  it('prompts and steers keep the answer body size on a narrow shell', () => {
    const bubble = /\[data-dsh-bubble\]\s*\{([^{}]*)\}/.exec(atlas)?.[1] ?? ''
    expect(bubble).toContain('font-size: 15.5px')
    const answerStart = atlas.indexOf("[data-chat-flow-kind^='assistant-step'] [class*='_body']")
    expect(answerStart).toBeGreaterThan(-1)
    expect(atlas.slice(answerStart, atlas.indexOf('}', answerStart))).toContain('font-size: 15.5px')
    // The narrow-shell media query must not raise only the prompt/steer panel.
    const narrow = /@media \(max-width: 900px\) \{([\s\S]*?)\n\}/.exec(atlas)?.[1] ?? ''
    expect(narrow).not.toMatch(/\[data-dsh-bubble\][^{}]*\{[^{}]*font-size/)
  })
})
