// @vitest-environment jsdom
// Streaming tail granularity: MarkdownText may fade only the characters that
// arrived since the previous chunk. The tail span is markup, not a text
// substitute, so every case pins the block's textContent against the parsed
// input — a split that loses, duplicates, or reorders a character is a bug.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as Md from 'mdast'
import { MarkdownText } from './markdown-test-components.tsx'
import { markdownLabels } from './labels.client.ts'
import { createReferenceTargets, renderBlocks } from '../src/markdown/render.tsx'
import type { MarkdownRenderContext } from '../src/markdown/render.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MarkdownText streaming tail', () => {
  it('wraps only the newly arrived suffix of a plain paragraph', () => {
    const { container } = render(
      <MarkdownText text="Hello world" streaming tailFrom={6} />,
    )

    const tails = container.querySelectorAll('[data-tail]')
    expect(tails).toHaveLength(1)
    expect(tails[0]?.textContent).toBe('world')
    expect(container.querySelector('p')?.textContent).toBe('Hello world')
  })

  it('keeps an inline construct whole when the offset falls inside it', () => {
    // 'A **bold** tail': the strong node starts at 2 and ends at 10, so a
    // tailFrom of 6 is inside it. The strong must stay one construct; the
    // trailing text after it is newly arrived as well.
    const bold = render(<MarkdownText text="A **bold** tail" streaming tailFrom={6} />)
    const strong = bold.container.querySelector('strong')
    expect(strong?.textContent).toBe('bold')
    expect(bold.container.querySelectorAll('strong')).toHaveLength(1)
    expect(bold.container.querySelector('[data-tail] strong')).toBe(strong)
    expect(bold.container.querySelector('[data-tail]')?.textContent).toBe('bold')
    expect(bold.container.textContent).toBe('A bold tail')
    bold.unmount()

    // 'A `code` tail': the inline code node spans offsets 2–7, so 5 lands
    // inside the code chip and the chip animates whole.
    const code = render(<MarkdownText text="A `code` tail" streaming tailFrom={5} />)
    const inline = code.container.querySelector('code')
    expect(inline?.textContent).toBe('code')
    expect(code.container.querySelectorAll('code')).toHaveLength(1)
    expect(code.container.querySelector('[data-tail] code')).toBe(inline)
    expect(code.container.querySelector('[data-tail]')?.textContent).toBe('code')
    expect(code.container.textContent).toBe('A code tail')
  })

  it('mounts a fresh tail span per delta without losing earlier characters', () => {
    const view = render(<MarkdownText text="Hello wor" streaming tailFrom={6} />)
    const first = view.container.querySelector('[data-tail]')
    expect(first?.textContent).toBe('wor')

    view.rerender(<MarkdownText text="Hello world" streaming tailFrom={9} />)
    const second = view.container.querySelector('[data-tail]')
    // A new element is what makes the one-shot animation fire again; reusing
    // the old node would either restart it (strobe) or never run it.
    expect(second).not.toBe(first)
    expect(second?.textContent).toBe('ld')
    expect(view.container.querySelectorAll('[data-tail]')).toHaveLength(1)
    expect(view.container.textContent).toBe('Hello world')
  })

  it('never renders a tail span once streaming is false', () => {
    const { container } = render(<MarkdownText text="Hello world" tailFrom={6} />)

    expect(container.querySelector('[data-tail]')).toBeNull()
    expect(container.textContent).toBe('Hello world')
  })

  it('skips wrapping a fenced code block instead of breaking its structure', () => {
    const source = '```ts\nconst answer = 42\n```'
    const { container } = render(<MarkdownText text={source} streaming tailFrom={10} />)

    expect(container.querySelector('[data-tail]')).toBeNull()
    expect(container.querySelector('pre code')?.textContent).toContain('const answer = 42')
  })

  it('renders the tail span without animation under reduced motion', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const { container } = render(
      <MarkdownText text="Hello world" streaming tailFrom={6} />,
    )

    const tail = container.querySelector<HTMLElement>('[data-tail]')
    expect(tail?.textContent).toBe('world')
    expect(tail?.style.animation).toBe('none')
  })

  it('skips a block with no source positions instead of guessing', () => {
    // Hand-built trees (and grammars that omit positions) leave the mark
    // unplaceable: render plainly, never throw and never wrap whole.
    const node: Md.Paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'plain' }] }
    const context: MarkdownRenderContext = {
      streaming: true,
      labels: markdownLabels,
      fileMentions: undefined,
      pathImages: undefined,
      targets: createReferenceTargets(),
      footnoteOrder: [],
      footnoteCounts: new Map(),
    }
    const { container } = render(<div>{renderBlocks([{ node, key: 0 }], context, 3)}</div>)

    expect(container.querySelector('[data-tail]')).toBeNull()
    expect(container.textContent).toBe('plain')
  })

  // Every split position, not just the friendly ones: the mark is markup, so
  // the rendered textContent must equal the settled parse's from any offset.
  // Escapes and character references are included because their mdast value is
  // shorter than the source span the offset indexes.
  const invariants = [
    'Plain words and more plain words.',
    'Escaped \\*star\\* and &amp; more.',
    '# Heading\n\n- first\n- second **bold** item\n\n> quoted `code`',
    '| A | B |\n| --- | --- |\n| one | two |\n\nLast paragraph.',
  ]
  it.each(invariants)('preserves the rendered text at every offset: %s', (source) => {
    const settled = render(<MarkdownText text={source} />)
    const expected = settled.container.textContent
    settled.unmount()

    for (let tailFrom = 0; tailFrom <= source.length; tailFrom += 1) {
      const live = render(<MarkdownText text={source} streaming tailFrom={tailFrom} />)
      expect(live.container.textContent).toBe(expected)
      live.unmount()
    }
  })
})
