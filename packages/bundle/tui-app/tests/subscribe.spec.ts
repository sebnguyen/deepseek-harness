/**
 * The identity filters in {@link tuiSubscribe}: frames from the runner's own
 * agent must reach the controller, foreign agents must not — a live bug was
 * shipped where the guard was inverted and the TUI showed empty turns, so
 * this spec locks the one-line logic in place.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { TuiController } from '../src/controller.ts'
import { tuiSubscribe } from '../src/index.ts'

/** A tiny Cordis context whose `on` captures handlers by event name. */
function fakeContext(): { context: Context; callHandler: (event: string, ...args: unknown[]) => unknown } {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const context = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler)
      return () => { handlers.delete(event) }
    },
  } as unknown as Context
  return {
    context,
    callHandler: (event, ...args) => {
      const handler = handlers.get(event)
      if (handler === undefined) throw new Error(`no handler for ${event}`)
      return handler(...args)
    },
  }
}

/** A controller whose ingest methods are spied. */
function fakeController(): TuiController & { frames: unknown[]; events: unknown[] } {
  const frames: unknown[] = []
  const events: unknown[] = []
  return {
    frames,
    events,
    ingestFrame: (frame: unknown) => { frames.push(frame) },
    ingestEvent: (event: unknown) => { events.push(event) },
  } as TuiController & { frames: unknown[]; events: unknown[] }
}

describe('tuiSubscribe', () => {
  it('forwards our agent\'s stream frames and drops foreign ones', () => {
    const { context, callHandler } = fakeContext()
    const controller = fakeController()
    const agent = { id: 'a' } as unknown as Agent
    const foreign = { id: 'b' } as unknown as Agent
    tuiSubscribe(context, controller, agent)
    const ours = { type: 'chunk', chunk: { type: 'text-delta', text: 'hi' } }
    const theirs = { type: 'chunk', chunk: { type: 'text-delta', text: 'no' } }
    callHandler('agent/assistant-stream', { agent, frame: ours })
    callHandler('agent/assistant-stream', { agent: foreign, frame: theirs })
    expect(controller.frames).toEqual([ours])
  })

  it('forwards session events for our session and drops foreign ones', () => {
    const { context, callHandler } = fakeContext()
    const controller = fakeController()
    const session = { id: 's-1' } as unknown as Session
    const agent = { id: 'a', session } as unknown as Agent
    tuiSubscribe(context, controller, agent)
    const event = { type: 'turn/start', data: { turn: 1 } } as unknown as SessionEvent
    const foreignSession = { id: 's-2' } as unknown as Session
    callHandler('session/event', session, event)
    callHandler('session/event', foreignSession, event)
    expect(controller.events).toEqual([event])
  })

  it('unsubscribes both listeners', () => {
    const { context, callHandler } = fakeContext()
    const controller = fakeController()
    const agent = { id: 'a', session: { id: 's-1' } } as unknown as Agent
    const subscriptions = tuiSubscribe(context, controller, agent)
    subscriptions.stream()
    subscriptions.events()
    expect(() => { callHandler('agent/assistant-stream', {}) }).toThrow()
    expect(() => { callHandler('session/event', {}, {}, {}, {}) }).toThrow()
    expect(controller.frames).toEqual([])
  })
})
