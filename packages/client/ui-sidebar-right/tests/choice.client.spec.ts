// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createSidebarRightChoiceStore, SIDEBAR_RIGHT_CHOICE_KEY } from '../src/client/choice.ts'

/** Persistence writes coalesce onto the next animation frame, or a microtask where rAF is absent. */
const flushPersist = (): Promise<void> => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { resolve() })
  else queueMicrotask(resolve)
})

beforeEach(async () => {
  await flushPersist()
  localStorage.clear()
})

describe('createSidebarRightChoiceStore', () => {
  it('starts open before the first choice', () => {
    expect(createSidebarRightChoiceStore().create().getSnapshot()).toEqual({ bySession: {} })
  })

  it('persists each Session\'s choice and restores it in a new instance', async () => {
    const first = createSidebarRightChoiceStore().create()
    first.actions.set('sess-1', false)
    first.actions.set('sess-2', true)
    await flushPersist()
    expect(JSON.parse(localStorage.getItem(SIDEBAR_RIGHT_CHOICE_KEY) ?? 'null')).toEqual({
      bySession: { 'sess-1': false, 'sess-2': true },
    })
    expect(createSidebarRightChoiceStore().create().getSnapshot()).toEqual({
      bySession: { 'sess-1': false, 'sess-2': true },
    })
    first.clearPersisted()
    expect(localStorage.getItem(SIDEBAR_RIGHT_CHOICE_KEY)).toBeNull()
  })
})
