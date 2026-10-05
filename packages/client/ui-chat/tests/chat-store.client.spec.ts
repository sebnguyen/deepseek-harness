import { describe, expect, it } from 'vitest'
import { createChatStore } from '../src/client/stores.ts'

describe('createChatStore', () => {
  it('stores only manually expanded Turn-process groups', () => {
    const store = createChatStore().create()
    store.actions.setTurnProcessOpen(2, 3, 5, true)
    expect(store.store.getSnapshot().turnProcesses).toEqual([{ turn: 2, answerStep: 3, group: 5 }])

    store.actions.setTurnProcessOpen(2, 4, 5, true)
    expect(store.store.getSnapshot().turnProcesses).toEqual([{ turn: 2, answerStep: 4, group: 5 }])

    store.actions.setTurnProcessOpen(2, 4, 6, true)
    store.actions.setTurnProcessOpen(2, 4, 5, false)
    expect(store.store.getSnapshot().turnProcesses).toEqual([{ turn: 2, answerStep: 4, group: 6 }])

    store.actions.setTurnProcessOpen(2, 4, 6, false)
    expect(store.store.getSnapshot().turnProcesses).toEqual([])
  })

  it('closes only the requested Turn-process group entry', () => {
    const store = createChatStore().create()
    store.actions.setTurnProcessOpen(2, 3, 5, true)
    store.actions.setTurnProcessOpen(3, 4, 7, true)

    store.actions.setTurnProcessOpen(2, 3, 5, false)
    store.actions.setTurnProcessOpen(9, 10, 5, false)

    expect(store.store.getSnapshot().turnProcesses).toEqual([{ turn: 3, answerStep: 4, group: 7 }])
  })
})
