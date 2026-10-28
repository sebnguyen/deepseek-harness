/**
 * The 6px flow gap is the shared transcript rhythm. The assistant/reasoning
 * body and the prompt stack deliberately add 6px above and below themselves;
 * the pce head, an unknown-block root and the turn-tail actions stay flush.
 * Content spacing inside a row (markdown block gaps, the answer action footer)
 * is not row spacing and stays.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(css: string, selector: string): string {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(css)
  if (rule === null) throw new Error(`stylesheet has no \`${selector}\` rule`)
  return rule[1] ?? ''
}

describe('transcript node row outer spacing', () => {
  it('keeps the pce head flush', () => {
    const head = declarations(read('../../ui-primitives/src/pce/PceRow.css'), '.pce-head')
    expect(head).toMatch(/padding:\s*0\s*;/)
  })

  it('gives the prompt stack a deliberate top and bottom margin', () => {
    const stack = declarations(read('../src/client/chat/MessageItem.module.css'), '.userStack')
    expect(stack).toContain('margin-top: 6px')
    expect(stack).toContain('margin-bottom: 6px')
  })

  it('gives the assistant and reasoning body a deliberate top and bottom margin', () => {
    const body = declarations(read('../src/client/chat/AssistantMarkdown.module.css'), '.body')
    expect(body).toContain('margin-top: 6px')
    expect(body).toContain('margin-bottom: 6px')
  })

  it('keeps an unknown-block root flush', () => {
    const css = read('../../ui-primitives/src/markdown/JsonBlock.module.css')
    expect(css).not.toMatch(/\.root\s*\{[^}]*margin-(top|bottom)/)
  })

  it('keeps the turn-tail actions flush', () => {
    const actions = declarations(read('../src/client/chat/TurnTailNodeView.module.css'), '.actions')
    expect(actions).not.toMatch(/margin-(top|bottom)/)
  })
})
