// @vitest-environment jsdom
// Streaming reveal: the parser freezes a block only once a later one exists, so
// while a reply is live the block the model is still writing is the unstable tail
// and never reaches the DOM. Everything that mounts is frozen, and the reveal
// cursor — not the network — decides when its characters appear: one span per
// tick, each kept until its swell has finished.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type * as Md from 'mdast'
import { MarkdownText as LocalizedMarkdownText } from '../src/index.ts'
import { markdownLabels } from './labels.client.ts'
import { createReferenceTargets, renderBlocks } from '../src/markdown/render.tsx'
import type { MarkdownRenderContext } from '../src/markdown/render.tsx'

/** The real component with the paced reveal the app uses (no test override). */
function MarkdownText(props: Omit<ComponentProps<typeof LocalizedMarkdownText>, 'labels'>) {
  return <LocalizedMarkdownText {...props} labels={markdownLabels} />
}

/** Mirrors REVEAL_TICK_MS in MarkdownText.tsx. */
const TICK = 40

/** Two paragraphs: the first is frozen, the second is the live tail. */
const FROZEN_DOC = 'Hello world\n\nNext paragraph.'

const baseContext: MarkdownRenderContext = {
  streaming: true,
  labels: markdownLabels,
  fileMentions: undefined,
  pathImages: undefined,
  targets: createReferenceTargets(),
  footnoteOrder: [],
  footnoteCounts: new Map(),
}

/** Position of a character in the source, as mdast stamps it. */
type Point = { line: number; column: number; offset: number }

/** An mdast point, which needs a line and column alongside the offset. */
function at(offset: number): Point {
  return { line: 1, column: offset + 1, offset }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Run the replay clock: each tick reveals one step of the frozen text. */
function ticks(count: number): void {
  act(() => {
    vi.advanceTimersByTime(TICK * count)
  })
}

/** What the reader can see: everything still veiled removed, separators joined. */
function shown(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement
  for (const veil of [...clone.querySelectorAll('[data-veil]')]) veil.remove()
  return (clone.textContent ?? '').replace(/\n/g, '')
}

/** The paragraph texts currently in the DOM, in order. */
function paragraphs(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('p')].map(paragraph => paragraph.textContent)
}

describe('MarkdownText frozen-only reveal', () => {
  it('renders nothing while the only block is still the unstable tail', () => {
    vi.useFakeTimers()
    const { container } = render(<MarkdownText text="Hello world" streaming />)
    ticks(10)
    // Not veiled, not partial: nothing is frozen, so the block is not in the DOM
    // at all and the cursor has nowhere to sweep.
    expect(container.textContent).toBe('')
    expect(container.querySelector('[data-veil]')).toBeNull()
    expect(container.querySelector('[data-tail]')).toBeNull()
  })

  it('mounts a block when it freezes and starts revealing on the next tick', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text="Hello world" streaming />)
    ticks(10)
    expect(view.container.textContent).toBe('')

    view.rerender(<MarkdownText text={FROZEN_DOC} streaming />)
    // Frozen: the block mounts veiled, so nothing shows until the cursor moves.
    expect(shown(view.container)).toBe('')
    expect(view.container.querySelector('[data-veil]')?.textContent).toBe('Hello world')

    ticks(1)
    expect(shown(view.container)).toBe('Hello')
    expect(view.container.querySelector('[data-veil]')?.textContent).toBe(' world')
  })

  it('gives each tick its own span and keeps the earlier one mounted', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text={FROZEN_DOC} streaming />)
    ticks(1)
    const first = view.container.querySelector('[data-tail]')
    expect(first?.textContent).toBe('Hello')

    ticks(1)
    const tails = [...view.container.querySelectorAll('[data-tail]')]
    // The earlier delta keeps its node, so its swell is not replayed; only the
    // new characters get a fresh span, keyed by their run start.
    expect(tails.map(tail => tail.textContent)).toEqual(['Hello', ' worl'])
    expect(tails[0]).toBe(first)
  })

  it('drops a span only after its animation has finished', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text={`${'a '.repeat(120)}\n\nNext paragraph.`} streaming />)
    // The window is six ticks wide, so the count plateaus instead of growing with
    // the reply: no span is ever cut mid-swell by the next tick.
    ticks(6)
    expect(view.container.querySelectorAll('[data-tail]')).toHaveLength(6)
    ticks(6)
    expect(view.container.querySelectorAll('[data-tail]')).toHaveLength(6)
  })

  it('stops at the last frozen block instead of revealing what cannot show', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text={'First block.\n\nSecond block is the tail.'} streaming />)
    ticks(100)
    // The cursor drains the frozen block and holds: the tail is not mounted, so
    // there is nothing for it to reveal, and nothing carries a mark afterwards.
    expect(paragraphs(view.container)).toEqual(['First block.'])
    expect(shown(view.container)).toBe('First block.')
    expect(view.container.querySelector('[data-tail]')).toBeNull()
    expect(view.container.querySelector('[data-veil]')).toBeNull()
  })

  it('reveals a newly frozen block only once it has frozen', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text={'First block.\n\nSecond block'} streaming />)
    ticks(100)
    expect(paragraphs(view.container)).toEqual(['First block.'])

    view.rerender(<MarkdownText text={'First block.\n\nSecond block\n\nThird block'} streaming />)
    // It froze, so it mounts — veiled, waiting its turn behind the cursor.
    expect(paragraphs(view.container)).toEqual(['First block.', 'Second block'])
    expect(shown(view.container)).toBe('First block.')

    ticks(1)
    expect(shown(view.container)).toBe('First block.Sec')
  })

  it('reveals the trailing block at the same cadence once the reply is final', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text={'Hello world\n\nSecond paragraph here.'} streaming />)
    ticks(200)
    // Only the frozen block is on screen while the reply can still grow.
    expect(paragraphs(view.container)).toEqual(['Hello world'])
    expect(view.container.querySelector('[data-tail]')).toBeNull()

    view.rerender(<MarkdownText text={'Hello world\n\nSecond paragraph here.'} streaming={false} />)
    // Final: the trailing block mounts veiled and is revealed by the cursor, so it
    // sweeps in instead of popping in whole.
    expect(paragraphs(view.container)).toEqual(['Hello world', 'Second paragraph here.'])
    expect(shown(view.container)).toBe('Hello world')
    expect(view.container.querySelector('[data-veil]')?.textContent).toBe('Second paragraph here.')

    ticks(1)
    expect(view.container.querySelector('[data-tail]')).not.toBeNull()

    ticks(200)
    expect(paragraphs(view.container)).toEqual(['Hello world', 'Second paragraph here.'])
    expect(shown(view.container)).toBe('Hello worldSecond paragraph here.')
    expect(view.container.querySelector('[data-tail]')).toBeNull()
    expect(view.container.querySelector('[data-veil]')).toBeNull()
  })

  it('shows a construct whole when the cursor lands inside it', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text={'A **bold** tail\n\nNext paragraph.'} streaming />)
    ticks(1)
    // Five source characters in ('A **b'), the cursor is inside the strong. Its
    // inline text carries no source positions of its own, so it cannot be cut:
    // the construct shows whole instead of half-rendering.
    expect(shown(view.container)).toBe('A bold')
    expect(view.container.querySelector('strong')?.textContent).toBe('bold')
    expect(view.container.querySelector('strong [data-veil]')).toBeNull()
    expect(view.container.querySelector('[data-tail]')?.textContent).toBe('A ')
  })

  it('hides a construct whole when the cursor precedes it', () => {
    // Unit-level: the veil lands before the strong, so the construct is wrapped
    // whole rather than half-visible.
    const node: Md.Paragraph = {
      type: 'paragraph',
      children: [
        { type: 'text', value: 'A ', position: { start: at(0), end: at(2) } },
        {
          type: 'strong',
          children: [{ type: 'text', value: 'bold', position: { start: at(4), end: at(8) } }],
          position: { start: at(2), end: at(10) },
        },
      ],
      position: { start: at(0), end: at(10) },
    }
    const { container } = render(<div>{renderBlocks([{ node, key: 0 }], baseContext, 2)}</div>)

    const veil = container.querySelector('[data-veil]')
    expect(veil?.querySelector('strong')?.textContent).toBe('bold')
    expect(container.textContent).toBe('A bold')
  })

  it('catches up on a burst instead of crawling', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text={`${'word '.repeat(60)}\n\nNext paragraph.`} streaming />)
    // One tick after 300 characters arrive: the step grows with the backlog, so
    // the reveal tracks the model instead of falling minutes behind it.
    ticks(1)
    const revealed = shown(view.container).length
    expect(revealed).toBeGreaterThan(5)
    expect(revealed).toBeLessThan(300)
  })

  it('keeps a settled block mounted when the next one freezes', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text={'First paragraph here.\n\nSecond paragraph here.'} streaming />)
    ticks(40)
    const [first] = [...view.container.querySelectorAll('p')]
    expect(first?.textContent).toBe('First paragraph here.')

    view.rerender(<MarkdownText text={'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.'} streaming />)
    ticks(40)
    // Settled elements are cached and reconciled, never rebuilt.
    expect([...view.container.querySelectorAll('p')][0]).toBe(first)
  })

  it('never veils or marks a settled render', () => {
    const { container } = render(<MarkdownText text="Hello world" />)
    expect(container.querySelector('[data-tail]')).toBeNull()
    expect(container.querySelector('[data-veil]')).toBeNull()
    expect(container.textContent).toBe('Hello world')
  })

  it('renders the reveal span without animation under reduced motion', () => {
    vi.useFakeTimers()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const view = render(<MarkdownText text={FROZEN_DOC} streaming />)
    ticks(1)
    const tail = view.container.querySelector<HTMLElement>('[data-tail]')
    expect(tail?.textContent).toBe('Hello')
    expect(tail?.style.animation).toBe('none')
  })

  it('renders plainly when a block has no source positions', () => {
    // Hand-built trees (and grammars that omit positions) cannot be cut, so the
    // cursor never settles them: render plainly, never throw and never veil.
    const node: Md.Paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'plain' }] }
    const { container } = render(<div>{renderBlocks([{ node, key: 0 }], baseContext, 3)}</div>)

    expect(container.querySelector('[data-tail]')).toBeNull()
    expect(container.querySelector('[data-veil]')).toBeNull()
    expect(container.textContent).toBe('plain')
  })

  // Every source shape the replay crosses, including escapes and character
  // references whose mdast value is shorter than the source span it indexes.
  const invariants = [
    'Plain words and more plain words.',
    'Escaped \\*star\\* and &amp; more.',
    '# Heading\n\n- first\n- second **bold** item\n\n> quoted `code`',
    '| A | B |\n| --- | --- |\n| one | two |\n\nLast paragraph.',
  ]
  it.each(invariants)('reveals every character exactly once: %s', (source) => {
    vi.useFakeTimers()
    const settled = render(<MarkdownText text={source} />)
    const expected = settled.container.textContent
    settled.unmount()

    const live = render(<MarkdownText text={source} streaming />)
    ticks(200)
    // The reply ends: the trailing block joins the replay and finishes there.
    live.rerender(<MarkdownText text={source} streaming={false} />)
    ticks(400)
    expect(live.container.textContent).toBe(expected)
    expect(live.container.querySelector('[data-veil]')).toBeNull()
  })
})

describe('MarkdownText reveal across a growing reply', () => {
  const DELTAS = [
    'First paragraph begins',
    ' and grows',
    ' with words.',
    '\n\nSecond paragraph starts',
    ' here.',
    '.\n\nThird paragraph carries',
    ' the answer onward.',
    '\n\nFourth paragraph is long',
    ' enough to keep the tail busy.',
  ]

  it('reveals paragraph by paragraph and settles each one clean', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text="" streaming />)
    let text = ''
    let previous = 0
    for (const delta of DELTAS) {
      text += delta
      view.rerender(<MarkdownText text={text} streaming />)
      ticks(2)
      // The reveal only moves forward and never runs past what was received, so
      // the reader never sees text appear and then vanish.
      const visible = shown(view.container).length
      expect(visible).toBeGreaterThanOrEqual(previous)
      expect(visible).toBeLessThanOrEqual(text.length)
      previous = visible
    }
    view.rerender(<MarkdownText text={text} streaming={false} />)
    ticks(600)
    // Drained: the whole reply is on screen, in block order.
    expect(paragraphs(view.container)).toEqual(text.split('\n\n'))
    expect(view.container.querySelector('[data-tail]')).toBeNull()
    expect(view.container.querySelector('[data-veil]')).toBeNull()
  })

  it('never remounts a paragraph the cursor has passed', () => {
    vi.useFakeTimers()
    const view = render(<MarkdownText text="" streaming />)
    let text = ''
    const nodes: Element[] = []
    for (const [index, delta] of DELTAS.entries()) {
      text += delta
      view.rerender(<MarkdownText text={text} streaming />)
      ticks(40)
      const current = [...view.container.querySelectorAll('p')]
      if (index === 2) nodes.push(...current)
      if (index >= 3) {
        // Earlier paragraphs stay the same DOM node: cached, not rebuilt.
        expect(current.slice(0, nodes.length)).toEqual(nodes)
      }
    }
  })
})
