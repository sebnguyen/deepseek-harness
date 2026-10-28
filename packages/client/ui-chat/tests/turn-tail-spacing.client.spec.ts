/** CSS checks for the completed-turn footer: content gap inside, flow gap outside. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/chat/${name}`, import.meta.url)), 'utf8')

describe('completed-turn spacing', () => {
  it('keeps the content gap inside and the row boundary on the flow', () => {
    // Spacing lives in the design layer's single flow rhythm; the row leaves its
    // outer boundary to ChatView instead of adding a per-kind offset.
    expect(read('ChatView.module.css')).not.toContain('--dsh-chat-flow-gap')
    const tail = read('TurnTailNodeView.module.css')
    expect(tail).toMatch(/\.root\s*\{[^}]*gap:\s*16px/s)
    expect(tail).not.toMatch(/\.actions\s*\{[^}]*margin-top/s)
  })
})
