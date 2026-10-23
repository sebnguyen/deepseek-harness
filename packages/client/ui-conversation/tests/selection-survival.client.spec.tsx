// @vitest-environment jsdom
/** Exercises Conversation persistence through the real SlotRegistry store axis. */
import { beforeEach, describe, expect, it } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { createConversationStore } from '../src/client/stores.ts'

const sid = (value: string): SessionId => value as SessionId

type ConversationInstance = ReturnType<ReturnType<typeof createConversationStore>['create']>

async function createBench() {
  const runtime = await SlotTestRuntime.create()
  const conversation = createConversationStore()
  await runtime.root.declare({
    'conversation.session': { kind: 'single', scope: 'session' },
    'conversation.session.header': { kind: 'single', scope: 'session' },
  }, (_props: PropsRenderSlots<'conversation.session' | 'conversation.session.header'>) => null)
  runtime.slots.register({ name: 'conversation.session', store: conversation }, () => null)
  runtime.slots.register({ name: 'conversation.session.header', store: conversation }, () => null)
  runtime.renderRoot()
  return { runtime }
}

function storeFor(
  current: Awaited<ReturnType<typeof createBench>>,
  slot: 'conversation.session' | 'conversation.session.header',
  sessionId: SessionId,
): ConversationInstance {
  return current.runtime.storeOf(slot, sessionId) as ConversationInstance
}

/** Persistence writes coalesce onto the next animation frame, or a microtask where rAF is absent. */
const flushPersist = (): Promise<void> => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { resolve() })
  else queueMicrotask(resolve)
})

beforeEach(async () => {
  await flushPersist()
  localStorage.clear()
})

describe('Conversation state survives on its store seat', () => {
  it('shares one instance between the Session body and header', async () => {
    const b = await createBench()
    await b.runtime.sessions.add({ id: 's1' })
    const body = storeFor(b, 'conversation.session', sid('s1'))
    const header = storeFor(b, 'conversation.session.header', sid('s1'))

    body.actions.setDraft('half-typed')
    header.actions.setView('trajectory')

    expect(header).toBe(body)
    expect(body.store.getSnapshot()).toMatchObject({ draft: 'half-typed', view: 'trajectory' })
    await b.runtime.dispose()
  })

  it('isolates Session instances and preserves identity across list projection updates', async () => {
    const b = await createBench()
    const oneId = sid('s1')
    await b.runtime.sessions.add({ id: 's1' })
    await b.runtime.sessions.add({ id: 's2' })
    const one = storeFor(b, 'conversation.session', oneId)
    const two = storeFor(b, 'conversation.session', sid('s2'))
    one.actions.setDraft('only one')
    two.actions.setDraft('only two')

    await b.runtime.sessions.updateSummary(oneId, { displayTitle: 'projected' })

    expect(storeFor(b, 'conversation.session', oneId)).toBe(one)
    expect(one.store.getSnapshot().draft).toBe('only one')
    expect(two.store.getSnapshot().draft).toBe('only two')
    await b.runtime.dispose()
  })

  it('buries the instance and persisted draft with the Session scope', async () => {
    const b = await createBench()
    await b.runtime.sessions.add({ id: 's1' })
    const doomed = storeFor(b, 'conversation.session', sid('s1'))
    doomed.actions.setDraft('to be buried')
    doomed.actions.setView('chat')
    await flushPersist()
    expect(localStorage.getItem('dsh.conversation.s1')).not.toBeNull()

    await b.runtime.sessions.remove('s1')

    expect(localStorage.getItem('dsh.conversation.s1')).toBeNull()
    await b.runtime.sessions.add({ id: 's1' })
    const reborn = storeFor(b, 'conversation.session', sid('s1'))
    expect(reborn).not.toBe(doomed)
    expect(reborn.store.getSnapshot()).toEqual({ draft: '', view: null, viewRequest: null })
    await b.runtime.dispose()
  })

  it('keeps a half-typed draft through a recency eviction and restores it on reopen', async () => {
    const b = await createBench()
    await b.runtime.sessions.add({ id: 's1' })
    const evicted = storeFor(b, 'conversation.session', sid('s1'))
    evicted.actions.setDraft('half-typed')
    await flushPersist()
    expect(localStorage.getItem('dsh.conversation.s1')).not.toBeNull()

    await b.runtime.sessions.evict('s1')

    // The scope's memory is gone, but the still-durable row keeps its draft.
    expect(localStorage.getItem('dsh.conversation.s1')).not.toBeNull()
    const reopened = storeFor(b, 'conversation.session', sid('s1'))
    expect(reopened).not.toBe(evicted)
    expect(reopened.store.getSnapshot().draft).toBe('half-typed')
    await b.runtime.dispose()
  })
})
