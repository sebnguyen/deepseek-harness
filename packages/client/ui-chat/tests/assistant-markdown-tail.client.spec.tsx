// @vitest-environment jsdom
// The fade suffix comes from the previous committed length of the trailing
// prose block. These cases pin that AssistantMarkdown hands MarkdownText the
// delta boundary rather than animating the whole body.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../src/client/contract/slots.ts'
import type { AssistantBlock } from '../src/client/contract/snapshot.ts'

afterEach(cleanup)

const t = ((_key: string) => 'label') as unknown as ChatViewSlotProps['t']
const renderMessageImages = (() => null) as unknown as ChatNodeOwnerProps['renderMessageImages']

function streamingText(view: ReturnType<typeof render>): Element | null {
  return view.container.querySelector('[data-tail]')
}

describe('AssistantMarkdown streaming tail', () => {
  it('fades only the text appended since the previous render', () => {
    const blocks = (text: string): AssistantBlock[] => [{ kind: 'text', text }]
    const view = render(
      <AssistantMarkdown
        blocks={blocks('Hello wor')}
        streaming
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    // The first committed chunk is all new.
    expect(streamingText(view)?.textContent).toBe('Hello wor')

    view.rerender(
      <AssistantMarkdown
        blocks={blocks('Hello world')}
        streaming
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    expect(streamingText(view)?.textContent).toBe('ld')
    expect(view.container.textContent).toBe('Hello world')
  })

  it('restarts the measurement when the trailing block changes', () => {
    const view = render(
      <AssistantMarkdown
        blocks={[{ kind: 'text', text: 'First' }]}
        streaming
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    expect(streamingText(view)?.textContent).toBe('First')

    view.rerender(
      <AssistantMarkdown
        blocks={[{ kind: 'text', text: 'First' }, { kind: 'text', text: 'Second' }]}
        streaming
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    // The completed first block drops its mark; the whole new block is the
    // arrival, so its stale previous length must not be reused.
    const tails = view.container.querySelectorAll('[data-tail]')
    expect(tails).toHaveLength(1)
    expect(tails[0]?.textContent).toBe('Second')
  })

  it('renders no tail span when streaming ends', () => {
    const view = render(
      <AssistantMarkdown
        blocks={[{ kind: 'text', text: 'Hello world' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    expect(streamingText(view)).toBeNull()
    expect(view.container.textContent).toBe('Hello world')
  })
})
