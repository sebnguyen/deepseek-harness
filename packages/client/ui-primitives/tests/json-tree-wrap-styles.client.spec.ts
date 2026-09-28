/** JsonTree's opt-in word wrap as CSS text. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/JsonTree.module.css', import.meta.url)), 'utf8')

describe('JsonTree.module.css word wrap', () => {
  it('leaves the default container on one line', () => {
    const container = css.match(/\.container\s*\{([^}]*)\}/)?.[1]
    expect(container).toContain('white-space: pre')
    expect(container).toContain('width: max-content')
  })

  it('wraps the container and the fixed-open top level under the wrap class', () => {
    const wrapped = css.match(
      /\.wrapRoot \.container,\s*\.wrapRoot \.expandedTopLevel\s*\{([^}]*)\}/,
    )?.[1]
    expect(wrapped).toContain('width: auto')
    expect(wrapped).toContain('white-space: pre-wrap')
    expect(wrapped).toContain('overflow-wrap: anywhere')
  })

  it('lets a wrapped row highlight cover the whole row', () => {
    const highlight = css.match(/\.wrapRoot \.row:not\(\.topLevelBracket\):hover[^{]*\{([^}]*)\}/)?.[1]
    expect(highlight).toContain('height: 100%')
  })
})
