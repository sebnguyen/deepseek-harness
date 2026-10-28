/**
 * PceRow's expanded body inset as CSS text. jsdom has no layout, so the only
 * place the internal spacing can be read is the stylesheet: an expanded body
 * must keep 8px from the head above and the row's end below, while a
 * keepMounted body collapsed to `hidden="until-found"` must reserve neither.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/pce/PceRow.css', import.meta.url)), 'utf8')
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`PceRow.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('PceRow.css expanded body', () => {
  it('insets only the expanded body inside the row top and bottom', () => {
    expect(declarations('.pce-body').some(part => part.startsWith('margin'))).toBe(false)
    expect(declarations('.pce-body[data-pce-expanded]')).toEqual(expect.arrayContaining(['margin: 8px 0']))
  })

  it('reserves no inset when keepMounted collapses the body', () => {
    expect(declarations('.pce-body[hidden]')).toEqual(expect.arrayContaining(['margin: 0', 'padding: 0']))
  })
})
