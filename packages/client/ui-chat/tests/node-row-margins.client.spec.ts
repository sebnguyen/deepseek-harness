/**
 * Transcript node rows must not carry their own outer vertical margin. The
 * flow gap is the only inter-row space; the expanded pce body's 8px inset is
 * the one intentional exception. Content spacing inside a row (markdown block
 * gaps, the answer action footer) is not row spacing and stays.
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

  it('keeps the prompt stack flush', () => {
    const stack = declarations(read('../src/client/chat/MessageItem.module.css'), '.userStack')
    expect(stack).not.toMatch(/margin-(top|bottom)/)
  })

  it('keeps the assistant and reasoning bodies flush', () => {
    const body = declarations(read('../src/client/chat/AssistantMarkdown.module.css'), '.body')
    expect(body).not.toMatch(/margin-(top|bottom)/)
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
