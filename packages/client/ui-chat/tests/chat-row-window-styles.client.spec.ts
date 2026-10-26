/**
 * Dormant row-window shells must stay in flow. `ChatNodeSeat` reserves a
 * dormant row's geometry with an empty height spacer, so the declined-row
 * rule's `:has(> *:only-child:empty)` arm would otherwise collapse the whole
 * shell to `display: none`. An element without a box never intersects the
 * observer again, which permanently clips every page between the reader and
 * the live tail after several `Load earlier` pulls. jsdom applies no module
 * CSS, so this pins the selector text and its `data-row-dormant` counterpart
 * in the seat.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readChat = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/chat/${name}`, import.meta.url)), 'utf8')

const css = readChat('ChatView.module.css').replace(/\/\*[\s\S]*?\*\//g, ' ')

describe('chat row-window dormant shells', () => {
  it('keeps dormant shells out of the declined-row collapse', () => {
    // The only rule that hides a shell whose only child is an empty element.
    const rule = /(?:^|[{}])\s*([^{}]*:has\(> \*:only-child:empty\)[^{}]*)\{([^{}]*)\}/.exec(css)
    expect(rule).not.toBeNull()
    const selectors = (rule?.[1] ?? '').split(',').map(part => part.trim()).filter(Boolean)
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      expect(selector).toContain(':not([data-row-dormant])')
    }
    expect(rule?.[2]).toMatch(/display:\s*none/)
  })

  it('marks a non-live seat with the selector token', () => {
    expect(readChat('ChatNodeSeat.tsx')).toContain("data-row-dormant={live ? undefined : ''}")
  })
})
