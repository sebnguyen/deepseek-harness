/** The Ink component tree of the terminal application. */

import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'ink-testing-library'

import { TuiController } from '../src/controller.ts'
import type { TuiDelegate } from '../src/controller.ts'
import { App } from '../src/view.tsx'

/** A delegate that captures what the view submits. */
interface Fixture {
  controller: TuiController
  prompts: string[]
}

function makeController(): Fixture {
  const prompts: string[] = []
  const delegate: TuiDelegate = {
    prompt: (text) => { prompts.push(text) },
    interrupt: () => undefined,
    clear: () => undefined,
    quit: () => undefined,
    facts: () => 'deepseek/deepseek-chat · /tmp/repo',
    statusLine: () => 'session session-1 · idle · cwd /tmp/repo',
    approvalLabel: () => 'ask (default)',
    setApprovalMode: mode => mode,
  }
  return { controller: new TuiController(delegate), prompts }
}

/** Flush a couple of Ink render ticks. */
async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 80))
}

/** Every captured output chunk (ink frames + out-of-band escape writes). */
function frames(view: { frames?: string[]; lastFrame(): string | undefined }): string {
  const rest = view.frames ?? []
  const last = view.lastFrame()
  return [...rest, ...(last === undefined ? [] : [last])].join('\n')
}

/** The most recent frame that renders the actual UI (filters escape-write frames). */
function uiFrame(view: { frames?: string[]; lastFrame(): string | undefined }): string {
  const candidates = [...(view.frames ?? []), view.lastFrame()].filter(
    (frame): frame is string => typeof frame === 'string',
  )
  return [...candidates].reverse().find(frame => frame.includes('ctrl+j newline')) ?? ''
}

/** Type one chunk at a time: the testing stdin is a one-shot data slot. */
async function type(instance: { stdin: { write(data: string): void } }, chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    instance.stdin.write(chunk)
    await settled()
  }
}

describe('App', () => {
  it('commits a typed burst whose carriage return rides the same chunk', async () => {
    // Real PTYs coalesce fast keystrokes: `/help\r` can arrive as one chunk.
    const fixture = makeController()
    const view = render(createElement(App, { controller: fixture.controller, color: false, sessionId: 'session-1', cwd: '/tmp/repo' }))
    await settled()
    view.stdin.write('/help\r')
    await settled()
    expect(view.lastFrame()).toContain('commands:')
    view.unmount()
  })

  it('inserts bracketed-paste bodies as literal multiline text', async () => {
    const fixture = makeController()
    const view = render(createElement(App, { controller: fixture.controller, color: false, sessionId: 'session-1', cwd: '/tmp/repo' }))
    await settled()
    view.stdin.write('\x1B[200~first\nsecond\x1B[201~')
    await settled()
    const frame = view.lastFrame() ?? ''
    expect(frame).toContain('first')
    expect(frame).toContain('second')
    expect(fixture.prompts).toEqual([])
    view.unmount()
  })

  it('echoes typed input inside the prompt frame', async () => {
    const fixture = makeController()
    const view = render(createElement(App, { controller: fixture.controller, color: false, sessionId: 'session-1', cwd: '/tmp/repo' }))
    await settled()
    await type(view, ['say hello'])
    expect(view.lastFrame()).toContain('say hello')
    view.unmount()
  })

  it('submits enter as a prompt entry and clears the buffer', async () => {
    const fixture = makeController()
    const view = render(createElement(App, { controller: fixture.controller, color: false, sessionId: 'session-1', cwd: '/tmp/repo' }))
    await settled()
    await type(view, ['run the tests', '\r'])
    expect(fixture.prompts).toEqual(['run the tests'])
    expect(frames(view)).toContain('run the tests')
    view.unmount()
  })

  it('renders the banner and working rows as controller state changes', async () => {
    const fixture = makeController()
    fixture.controller.pushEntry({ kind: 'banner', lines: ['dsh · terminal profile'] })
    fixture.controller.ingestEvent({ type: 'turn/start', data: { turn: 1 } } as never)
    fixture.controller.ingestFrame({ type: 'chunk', chunk: { type: 'text-delta', text: 'streamed answer' } } as never)
    const view = render(createElement(App, { controller: fixture.controller, color: false, sessionId: 'session-1', cwd: '/tmp/repo' }))
    await settled()
    const frame = frames(view)
    expect(frame).toContain('dsh · terminal profile')
    expect(frame).toContain('streamed answer')
    expect(frame).toContain('working…')
    view.unmount()
  })

  it('shows the approval question and answers with single keys', async () => {
    const fixture = makeController()
    const view = render(createElement(App, { controller: fixture.controller, color: false, sessionId: 'session-1', cwd: '/tmp/repo' }))
    await settled()
    const ask = fixture.controller.requestApproval({ toolName: 'write' })
    await settled()
    expect(frames(view)).toContain('write asks for approval')
    await type(view, ['y'])
    await expect(ask).resolves.toBe('allowed-once')
    await settled()
    expect(frames(view)).toContain('allowed once')
    view.unmount()
  })

  it('pages up and down through the transcript and shows the scroll hint', async () => {
    const fixture = makeController()
    for (let index = 1; index <= 45; index += 1) {
      fixture.controller.pushEntry({ kind: 'note', text: `row ${index}` })
    }
    const view = render(createElement(App, { controller: fixture.controller, color: false, sessionId: 'session-1', cwd: '/tmp/repo' }))
    await settled()
    expect(frames(view)).toContain('row 45')
    await type(view, ['\x1B[5~'])
    const scrolled = uiFrame(view)
    expect(scrolled).toContain('row 37')
    expect(scrolled).not.toContain('row 45')
    expect(scrolled).toContain('scrolled 8')
    await type(view, ['\x1B[6~'])
    expect(uiFrame(view)).toContain('row 45')
    view.unmount()
  })

  it('edits the buffer with backspace and slash commands render help', async () => {
    const fixture = makeController()
    const view = render(createElement(App, { controller: fixture.controller, color: false, sessionId: 'session-1', cwd: '/tmp/repo' }))
    await settled()
    await type(view, ['/hep', '\x1B[D', 'l', '\r'])
    expect(view.lastFrame()).toContain('commands:')
    view.unmount()
  })
})
