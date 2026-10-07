import { describe, expect, it } from 'vitest'
import { createChatStore } from '../src/client/stores.ts'

describe('createChatStore', () => {
  it('stores only manually expanded spans', () => {
    const store = createChatStore().create()
    store.actions.setSpanOpen('2:3', true)
    expect(store.store.getSnapshot().openSpans).toEqual(['2:3'])

    store.actions.setSpanOpen('2:3', true)
    store.actions.setSpanOpen('2:4', true)
    expect(store.store.getSnapshot().openSpans).toEqual(['2:3', '2:4'])

    store.actions.setSpanOpen('2:3', false)
    expect(store.store.getSnapshot().openSpans).toEqual(['2:4'])
  })

  it('closes only the requested span entry', () => {
    const store = createChatStore().create()
    store.actions.setSpanOpen('2:3', true)
    store.actions.setSpanOpen('3:4', true)

    store.actions.setSpanOpen('2:3', false)
    store.actions.setSpanOpen('9:10', false)

    expect(store.store.getSnapshot().openSpans).toEqual(['3:4'])
  })
})
