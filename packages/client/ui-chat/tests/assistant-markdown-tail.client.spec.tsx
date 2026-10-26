// @vitest-environment jsdom
// AssistantMarkdown feeds a growing prose block through the reveal replay: the
// component drives the parser, the renderer decides what is on screen, and the
// replay cadence (not the network) paces the reveal. Only frozen blocks mount, so
// these cases pin that a live reply shows finished blocks, that the last one
// sweeps in when the reply ends, and that nothing leaves a mark behind.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../src/client/contract/slots.ts'
import type { AssistantBlock } from '../src/client/contract/snapshot.ts'

const TICK = 40

const t = ((_key: string) => 'label') as unknown as ChatViewSlotProps['t']
const renderMessageImages = (() => null) as unknown as ChatNodeOwnerProps['renderMessageImages']

const blocks = (text: string): AssistantBlock[] => [{ kind: 'text', text }]

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Run the replay clock. */
function ticks(count: number): void {
  act(() => {
    vi.advanceTimersByTime(TICK * count)
  })
}

/** Every marked span, in document order. */
function marks(view: ReturnType<typeof render>): (string | null)[] {
  return [...view.container.querySelectorAll('[data-tail]')].map(tail => tail.textContent)
}

/** Text with block separators joined, for prefix comparisons against the source. */
function flat(value: string): string {
  return value.replace(/\n/g, '')
}

function paragraphs(view: ReturnType<typeof render>): (string | null)[] {
  return [...view.container.querySelectorAll('p')].map(paragraph => paragraph.textContent)
}

describe('AssistantMarkdown streaming reveal', () => {
  it('shows frozen blocks, then sweeps in the final one at the same cadence', () => {
    vi.useFakeTimers()
    const view = render(
      <AssistantMarkdown blocks={blocks('')} streaming renderMessageImages={renderMessageImages} t={t} />,
    )
    let text = ''
    const deltas = ['First paragraph begins', ' and grows', ' with words.', '\n\nSecond paragraph starts', ' here.']
    for (const delta of deltas) {
      text += delta
      view.rerender(
        <AssistantMarkdown blocks={blocks(text)} streaming renderMessageImages={renderMessageImages} t={t} />,
      )
      ticks(2)
      // Everything on screen came from the received source, in order — no block
      // renders text the model has not written yet.
      expect(flat(text).startsWith(flat(view.container.textContent ?? ''))).toBe(true)
    }

    view.rerender(
      <AssistantMarkdown blocks={blocks(text)} streaming={false} renderMessageImages={renderMessageImages} t={t} />,
    )
    // The reply ended: the trailing block mounts and the cursor finishes the sweep.
    expect(paragraphs(view)).toEqual(text.split('\n\n'))
    ticks(600)
    expect(paragraphs(view)).toEqual(text.split('\n\n'))
    // Drained: no spans, no veils, and the settled render agrees.
    expect(marks(view)).toEqual([])
    expect(view.container.querySelector('[data-veil]')).toBeNull()

    const settled = render(
      <AssistantMarkdown blocks={blocks(text)} streaming={false} renderMessageImages={renderMessageImages} t={t} />,
    )
    expect(view.container.textContent).toBe(settled.container.textContent)
  })

  it('leaves no mark on a paragraph the cursor has passed', () => {
    vi.useFakeTimers()
    const view = render(
      <AssistantMarkdown blocks={blocks('')} streaming renderMessageImages={renderMessageImages} t={t} />,
    )
    // Chunk by chunk, as the projection delivers it: the trailing block stays
    // unstable, and only the blocks behind it freeze and render.
    let text = 'First paragraph begins.'
    view.rerender(
      <AssistantMarkdown blocks={blocks(text)} streaming renderMessageImages={renderMessageImages} t={t} />,
    )
    ticks(200)
    text += '\n\nSecond paragraph starts.'
    view.rerender(
      <AssistantMarkdown blocks={blocks(text)} streaming renderMessageImages={renderMessageImages} t={t} />,
    )
    ticks(200)
    text += '\n\nThird paragraph carries on.'
    view.rerender(
      <AssistantMarkdown blocks={blocks(text)} streaming renderMessageImages={renderMessageImages} t={t} />,
    )
    ticks(400)
    // The third paragraph is still the unstable tail: it is not rendered at all.
    expect(paragraphs(view)).toEqual(['First paragraph begins.', 'Second paragraph starts.'])
    // A block the replay has finished with is a cached element: no span in it.
    for (const paragraph of view.container.querySelectorAll('p')) {
      expect(paragraph.querySelector('[data-tail]')).toBeNull()
    }
  })

  it('renders no mark or veil when streaming is false', () => {
    const view = render(
      <AssistantMarkdown
        blocks={[{ kind: 'text', text: 'Hello world' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    expect(marks(view)).toEqual([])
    expect(view.container.querySelector('[data-veil]')).toBeNull()
    expect(view.container.textContent).toBe('Hello world')
  })
})
