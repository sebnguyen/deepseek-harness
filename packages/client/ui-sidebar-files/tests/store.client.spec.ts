/**
 * The tree's write set, one tree at a time.
 *
 * Two facts here are load-bearing for the body: a collapsed level keeps what it
 * loaded (reopening draws at once), and `reset` clears levels while keeping the
 * expanded set, which is what lets the reload gesture know which levels to ask
 * for again.
 */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createFilesStore } from '../src/client/store.ts'
import type { DirLevel } from '../src/client/store.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const ROOT = '/work/app'
const TAB = 'tab-1' as TabId

const LEVEL: DirLevel = {
  entries: [{ name: 'src', type: 'directory' }, { name: 'README.md', type: 'file', size: 12 }],
  truncated: false,
}

/** The single tree under test, typed to its fields. */
function getSnapshotOf(store: ReturnType<ReturnType<typeof createFilesStore>['create']>) {
  return store.getSnapshot().byTree[TAB]!
}

describe('createFilesStore', () => {
  it('mints an independent instance per call', () => {
    const first = createFilesStore().create()
    const second = createFilesStore().create()
    first.actions.start(TAB, ROOT)
    expect(second.getSnapshot().byTree[TAB]).toBeUndefined()
  })

  it('seeds a tab at its root with the root expanded and nothing loaded', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(TAB, ROOT)
    expect(getSnapshot().byTree[TAB]).toEqual({
      root: ROOT, levels: {}, expanded: [ROOT], highlighted: null,
    })
  })

  it('walks one level through loading, ready, and failed', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(TAB, ROOT)
    actions.loading(TAB, ROOT)
    expect(getSnapshot().byTree[TAB]!.levels[ROOT]).toEqual({ kind: 'loading' })
    actions.loaded(TAB, ROOT, LEVEL)
    expect(getSnapshot().byTree[TAB]!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL })
    const failure = new RemoteError('workspace-file/not-found', 'gone', { path: ROOT })
    actions.failed(TAB, ROOT, failure)
    expect(getSnapshot().byTree[TAB]!.levels[ROOT]).toEqual({ kind: 'failed', failure })
  })

  it('toggles a directory in and out of the expanded set without touching its level', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    const child = `${ROOT}/src`
    actions.start(TAB, ROOT)
    actions.loaded(TAB, child, LEVEL)
    actions.toggled(TAB, child)
    expect(getSnapshot().byTree[TAB]!.expanded).toEqual([ROOT, child])
    actions.toggled(TAB, child)
    expect(getSnapshot().byTree[TAB]!.expanded).toEqual([ROOT])
    // Collapsing keeps the listing, so reopening draws without another fetch.
    expect(getSnapshot().byTree[TAB]!.levels[child]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('reset drops every level and keeps the expanded set', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    const child = `${ROOT}/src`
    actions.start(TAB, ROOT)
    actions.loaded(TAB, ROOT, LEVEL)
    actions.toggled(TAB, child)
    actions.loaded(TAB, child, LEVEL)
    actions.reset(TAB)
    expect(getSnapshot().byTree[TAB]).toEqual({
      root: ROOT, levels: {}, expanded: [ROOT, child], highlighted: null,
    })
  })

  it('reveal expands ancestor directories idempotently and never collapses one', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const child = `${ROOT}/src`
    const deep = `${ROOT}/src/util`
    actions.start(TAB, ROOT)
    actions.toggled(TAB, child)
    actions.expandedPaths(TAB, [ROOT, child, deep])
    expect(getSnapshotOf(store).expanded).toEqual([ROOT, child, deep])
    // A directory the reader collapsed stays collapsed where toggled, but a
    // reveal re-expands it: the reveal's instruction is "show this file".
    actions.toggled(TAB, child)
    actions.expandedPaths(TAB, [ROOT, child, deep])
    expect(getSnapshotOf(store).expanded).toEqual([ROOT, deep, child])
  })

  it('reveal highlight sets then clears only its own path', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    const file = `${ROOT}/README.md`
    actions.highlightedSet(TAB, file)
    expect(getSnapshotOf(store).highlighted).toBe(file)
    // A stale clear of another path leaves the newer highlight alone.
    actions.highlightedClear(TAB, `${ROOT}/other.ts`)
    expect(getSnapshotOf(store).highlighted).toBe(file)
    actions.highlightedClear(TAB, file)
    expect(getSnapshotOf(store).highlighted).toBeNull()
  })

  it('reveal writes are no-ops for a tree that was never started', () => {
    const store = createFilesStore().create()
    const { actions } = store
    expect(() => {
      actions.expandedPaths('tab-nowhere' as TabId, [ROOT])
      actions.highlightedSet('tab-nowhere' as TabId, `${ROOT}/a.ts`)
      actions.highlightedClear('tab-nowhere' as TabId, `${ROOT}/a.ts`)
    }).not.toThrow()
    expect(store.getSnapshot().byTree['tab-nowhere' as TabId]).toBeUndefined()
  })

  it('refuses to write a level for a tree that was never started', () => {
    const { actions } = createFilesStore().create()
    expect(() => { actions.loading('tab-nowhere' as TabId, ROOT) }).toThrow('no tree for "tab-nowhere"')
  })

  it('forget removes exactly the tab that went away', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(TAB, ROOT)
    actions.start('tab-2' as TabId, ROOT)
    actions.forget(TAB)
    expect(Object.keys(getSnapshot().byTree)).toEqual(['tab-2'])
  })
})
