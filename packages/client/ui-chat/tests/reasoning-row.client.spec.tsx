// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locale.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'

afterEach(() => {
  cleanup()
})

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

describe('ReasoningRow', () => {
  it('shows the running mark and a truncated excerpt of the reasoning while it streams', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.container.querySelector('.pce-head-state.is-running')).not.toBeNull()
    // The head carries one line of the stream: the whitespace collapses, so
    // the two source lines read as one.
    expect(view.container.querySelector('.pce-description')?.textContent)
      .toBe('Inspect the session Newest reasoning tokens')

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.container.querySelector('.pce-head-state.is-running')).not.toBeNull()
    expect(view.container.querySelector('.pce-description')?.textContent)
      .toBe('Inspect the session Newest reasoning tokens keep arriving')

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving\n' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    // Settled: a bare check mark with no text in the mark cell, and the
    // excerpt stays.
    expect(view.container.querySelector('[data-glyph="check"]')).not.toBeNull()
    expect(view.container.querySelector('.pce-head-state')?.textContent).toBe('')
    expect(view.container.querySelector('.pce-description')?.textContent)
      .toBe('Inspect the session Newest reasoning tokens keep arriving')
  })

  it('flattens the markdown and caps the head excerpt at one line', () => {
    const text = `**Comparing checkout and merge bases**\n${'The merge base moved, so the store contract needs another read. '.repeat(4)}`
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    const excerpt = view.container.querySelector('.pce-description')?.textContent ?? ''
    // The Markdown is flattened, the whitespace collapsed, and the line capped.
    expect(excerpt.startsWith('Comparing checkout and merge bases')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt.length).toBeLessThanOrEqual(120)
    expect(excerpt).not.toContain('**')
    // The whole stream never reaches the head.
    expect(excerpt.length).toBeLessThan(text.length)
  })

  it('expands from the Think title', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    const row = view.getByRole('button')

    fireEvent.click(view.getByText('思考'))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    // The body holds the stream; the head holds only its one-line excerpt.
    expect(view.container.querySelector('[class*="thinkBody"]')?.textContent).toContain('Check persistence')

    fireEvent.click(view.getByText('思考'))
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the full reasoning body in the expanded disclosure', () => {
    const text = '**Comparing checkout and merge bases**\nKeep **reviewing**'
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )

    expect(view.container.querySelector('[data-glyph="check"]')).not.toBeNull()
    // Collapsed: the body is not mounted, and the head holds only its excerpt.
    expect(view.container.querySelector('[class*="thinkBody"]')).toBeNull()
    expect(view.container.querySelector('.pce-description')?.textContent)
      .toBe('Comparing checkout and merge bases Keep reviewing')

    fireEvent.click(view.getByText('思考'))
    expect(view.container.querySelector('[class*="thinkBody"]')?.textContent).toBe(text)
  })

  it('expanded Think renders plain prose, no IN card, and keeps the head excerpt', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    fireEvent.click(view.getByText('思考'))
    // The body holds the whole stream; the head keeps its one-line excerpt.
    expect(view.container.querySelector('[class*="thinkBody"]')?.textContent)
      .toBe('Inspect the session\nCheck persistence')
    expect(view.container.querySelector('.pce-description')?.textContent)
      .toBe('Inspect the session Check persistence')
    expect(view.queryByText('IN')).toBeNull()
    expect(view.container.querySelector('[class*="ioCard"]')).toBeNull()
  })
})
