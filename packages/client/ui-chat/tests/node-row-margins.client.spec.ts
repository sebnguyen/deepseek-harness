/**
 * The 8px flow gap is the shared transcript rhythm. The assistant message body
 * and the prompt stack deliberately add 6px above and below themselves; the
 * Think row, the pce head, an unknown-block root and the turn-tail actions stay
 * flush. Content spacing inside a row (markdown block gaps, the answer action
 * footer) is not row spacing and stays.
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

  it('insets the assistant message body but not the Think row', () => {
    const css = read('../src/client/chat/AssistantMarkdown.module.css')
    const body = declarations(css, '.body')
    expect(body).not.toMatch(/margin-(top|bottom)/)
    const inset = declarations(css, '.body[data-inset]')
    expect(inset).toContain('margin-top: 6px')
    expect(inset).toContain('margin-bottom: 6px')
    const view = read('../src/client/chat/AssistantNodeView.tsx')
    expect(view).toContain("inset={node.kind === 'assistant-step-message'}")
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
