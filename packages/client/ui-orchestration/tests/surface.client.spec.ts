// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { childIds, selectPeers } from '../src/client/surface.ts'

const s = (value: string): SessionId => value as SessionId

function state(input: {
  current?: SessionId
  ids: SessionId[]
  parents?: Record<string, SessionId>
  children?: Record<string, SessionId[]>
}): SessionListState {
  return {
    ids: input.ids,
    byId: Object.fromEntries(input.ids.map(id => [id, {
      id,
      displayTitle: id,
      blank: false,
      running: false,
      updatedAt: 0,
      parentId: input.parents?.[id],
    }])),
    current: input.current,
    phase: 'ready',
    subagentsByParent: Object.fromEntries(Object.entries(input.children ?? {}).map(([parent, children]) => [parent, {
      state: 'ready',
      error: null,
      parentAvailable: true,
      entries: children.map(child => ({
        kind: 'child',
        id: child,
        activity: 'inactive',
        hasChildren: false,
        mode: 'continuable',
        label: child,
      })),
    }])),
    jobsBySession: {},
    jobOutputBySession: {},
    currentAddress: undefined,
  } as unknown as SessionListState
}

describe('orchestration peer selection', () => {
  it('projects a current child beside its parent', () => {
    const peer = selectPeers(state({
      current: s('child'),
      ids: [s('root'), s('child')],
      parents: { [s('child')]: s('root') },
    }))
    expect(peer).toEqual({ first: s('root'), second: s('child'), linked: true })
  })

  it('projects a current root beside its first direct child', () => {
    const peer = selectPeers(state({
      current: s('root'),
      ids: [s('root'), s('child')],
      children: { [s('root')]: [s('child')] },
    }))
    expect(peer).toEqual({ first: s('root'), second: s('child'), linked: true })
  })

  it('falls back to an unrelated second Session', () => {
    const peer = selectPeers(state({
      current: s('a'),
      ids: [s('a'), s('b')],
    }))
    expect(peer).toEqual({ first: s('a'), second: s('b'), linked: false })
  })

  it('returns no panes without a current Session', () => {
    expect(selectPeers(state({ ids: [s('a')] }))).toEqual({
      first: undefined, second: undefined, linked: false,
    })
  })

  it('lists only direct-child entries', () => {
    const list = childIds(state({
      current: s('root'),
      ids: [s('root'), s('child')],
      children: { [s('root')]: [s('child')] },
    }), s('root'))
    expect(list).toEqual([s('child')])
  })
})
