/**
 * The chat flow's font-size-axis adoption as CSS text. jsdom has no layout,
 * so these read the declarations that make think text, compaction rows, the
 * message clock, and the icon-action buttons follow the Settings font-size
 * preference through --dsh-content-font-size / --dsh-content-font-delta.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/chat/${name}`, import.meta.url)), 'utf8')

function declarationsFrom(source: string, selector: string): string[] {
  const declarationText = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rule = new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('chat flow font-size axis', () => {
  it('think text reads the secondary tier (one step under the body size)', () => {
    const css = read('ReasoningRow.module.css')
    for (const selector of ['.summary', '.thinkBody']) {
      expect(declarationsFrom(css, selector)).toEqual(expect.arrayContaining([
        'font-size: var(--dsh-content-font-size-secondary, 13px)',
        'line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
      ]))
    }
  })

  it('command and context summaries read the secondary tier on the shared row line', () => {
    expect(declarationsFrom(read('GenericCommandCard.module.css'), '.summary')).toEqual(expect.arrayContaining([
      'font-size: var(--dsh-content-font-size-secondary, 13px)',
      'line-height: calc(24px + var(--dsh-content-font-delta, 0px))',
    ]))
    const context = read('ContextInjectionRow.module.css')
    for (const selector of ['.source', '.summary']) {
      expect(declarationsFrom(context, selector)).toEqual(expect.arrayContaining([
        'font-size: var(--dsh-content-font-size-secondary, 13px)',
        'line-height: calc(24px + var(--dsh-content-font-delta, 0px))',
      ]))
    }
  })

  it('the message clock and action glyphs scale with the text they serve', () => {
    const actions = read('MessageIconActions.module.css')
    // Both clocks read the secondary tier: the assistant tail's meta line
    // (the whole-line usage trigger) and the user row's clock stay one step
    // under the body size so the two rows match.
    expect(declarationsFrom(actions, '.timeStart')).toEqual(expect.arrayContaining([
      'font-size: var(--dsh-content-font-size-secondary, 13px)',
    ]))
    expect(declarationsFrom(actions, '.timeEnd')).toEqual(expect.arrayContaining([
      'font-size: var(--dsh-content-font-size-secondary, 13px)',
    ]))
    // The user prompt's Turn caption rides the same meta line as the clock.
    expect(declarationsFrom(actions, '.turn')).toEqual(expect.arrayContaining([
      'font-size: var(--dsh-content-font-size-secondary, 13px)',
      'line-height: calc(24px + var(--dsh-content-font-delta, 0px))',
    ]))
    expect(declarationsFrom(actions, '.action svg')).toEqual(expect.arrayContaining([
      'width: calc(15px + var(--dsh-content-font-delta, 0px))',
      'height: calc(15px + var(--dsh-content-font-delta, 0px))',
    ]))
  })

  it('compaction rows follow the axis like the disclosure rows they mirror', () => {
    const css = read('MessageItem.module.css')
    for (const selector of ['.compactionTitle', '.compactionSummary', '.compactionBody']) {
      expect(declarationsFrom(css, selector)).toEqual(expect.arrayContaining([
        'font-size: var(--dsh-content-font-size-secondary, 13px)',
        'line-height: calc(24px + var(--dsh-content-font-delta, 0px))',
      ]))
    }
    expect(declarationsFrom(css, '.compactionLeading svg')).toEqual(expect.arrayContaining([
      'width: calc(14px + var(--dsh-content-font-delta, 0px))',
      'height: calc(14px + var(--dsh-content-font-delta, 0px))',
    ]))
  })

  it('expanded bodies stay flat with the head so content reads as one column', () => {
    // The body is flush with the row: no indent under the mark, at any size.
    expect(declarationsFrom(read('ReasoningRow.module.css'), '.thinkBody'))
      .toEqual(expect.arrayContaining(['padding: 0']))
    expect(declarationsFrom(read('MessageItem.module.css'), '.compactionBody'))
      .toEqual(expect.arrayContaining(['padding: 0']))
    expect(declarationsFrom(read('ContextInjectionRow.module.css'), '.body'))
      .toEqual(expect.arrayContaining(['margin: 4px 0 0']))
  })

  it('the usage-details trigger reads the secondary tier like its clock label', () => {
    const css = read('TurnUsagePanel.module.css')
    expect(declarationsFrom(css, '.trigger')).toEqual(expect.arrayContaining([
      'font-size: var(--dsh-content-font-size-secondary, 13px)',
      'line-height: calc(24px + var(--dsh-content-font-delta, 0px))',
    ]))
  })

  it('the usage pill sizes its glyph and hit height like the sibling action buttons', () => {
    // The pill sits in the icon row right of the branch action; its data glyph
    // and 28px hit height follow the same delta rule as `.action` so the row
    // stays one height at every font size.
    const css = read('TurnUsagePanel.module.css')
    expect(declarationsFrom(css, '.trigger')).toEqual(expect.arrayContaining([
      'height: calc(28px + var(--dsh-content-font-delta, 0px))',
      'white-space: nowrap',
      'min-width: 0',
    ]))
    expect(declarationsFrom(css, '.trigger svg')).toEqual(expect.arrayContaining([
      'width: calc(15px + var(--dsh-content-font-delta, 0px))',
      'height: calc(15px + var(--dsh-content-font-delta, 0px))',
    ]))
    // A narrow column trims the pill label to an ellipsis instead of letting
    // it overflow or widen the chat column.
    expect(declarationsFrom(css, '.label')).toEqual(expect.arrayContaining([
      'min-width: 0',
      'overflow: hidden',
      'text-overflow: ellipsis',
    ]))
  })

  it('narrow viewports collapse the stat pills to the action-button circle', () => {
    // Below 480px the label hides and the pill takes the sibling `.action`
    // geometry (28px width, 6px padding, centered glyph); the -6px
    // label-padding rebate between adjacent pills resets so the icon pair
    // keeps the row's plain 8px rhythm instead of overlapping.
    const css = read('TurnUsagePanel.module.css')
    const narrow = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(narrow).toMatch(/\.trigger \{[^}]*justify-content: center/)
    expect(narrow).toMatch(/\.trigger \{[^}]*width: calc\(28px \+ var\(--dsh-content-font-delta, 0px\)\)/)
    expect(narrow).toMatch(/\.trigger \{[^}]*padding: 6px/)
    expect(narrow).toMatch(/\.trigger \.label \{[^}]*display: none/)
    expect(narrow).toMatch(/\.root \+ \.root \{[^}]*margin-left: 0/)
  })

  it('every message footer row stays visible without a reveal gate', () => {
    // The prompt footer states the turn number and offers copy; the row
    // carries no opacity rule and no hover or focus gate.
    const css = read('MessageIconActions.module.css')
    expect(css).not.toContain('data-actions-reveal')
    expect(css).not.toMatch(/opacity:\s*0\s*[;}]/)
    expect(css).not.toContain('hover: hover')
    // The row grid owns the spacing: every row, the tail included, ends with
    // the same 8px margin and keeps no per-kind override.
    const flow = read('ChatView.module.css')
    expect(flow).not.toContain('--dsh-chat-flow-gap')
  })

  it('drops the flow sibling selector that gated the earlier user rows', () => {
    const css = read('MessageIconActions.module.css')
    expect(css).not.toContain(':has(')
    expect(css).not.toContain('):hover .actions')
    expect(css).not.toContain('):focus-within .actions')
  })

  it('the interrupted-turn tag stays fixed like the dense token variants', () => {
    // 11px would fall to an illegible 9px at the 12px floor; the tag is
    // exempt from the axis the same way small/code tokens are.
    expect(declarationsFrom(read('AssistantMarkdown.module.css'), '.stopped')).toEqual(expect.arrayContaining([
      'font-size: 11px',
      'line-height: 18px',
    ]))
  })
})
