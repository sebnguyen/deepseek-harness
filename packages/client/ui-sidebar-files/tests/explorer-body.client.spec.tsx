// @vitest-environment jsdom
/**
 * The explorer column against a scripted listing.
 *
 * The column keeps its tree under the session id in the store the tab type
 * shares, opens files through the sidebar navigation face rather than a tab
 * owner, and forgets the session's tree when its mount ends.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { explorerFace } from '../src/client/face.ts'
import { ExplorerBody } from '../src/client/ExplorerBody.tsx'
import type { ExplorerBodyProps } from '../src/client/ExplorerBody.tsx'
import { zh } from '../src/client/locales.ts'
import { createRevealChannel } from '../src/client/reveal.ts'
import { createFilesStore } from '../src/client/store.ts'
import type { DirLevel } from '../src/client/store.ts'
import { scriptedList } from './scripted-list.client.ts'

const SESSION = 's-test' as SessionId
const ROOT = '/work/app'

const ROOT_LEVEL: DirLevel = {
  entries: [
    { name: 'README.md', type: 'file', size: 12 },
    { name: 'src', type: 'directory' },
  ],
  truncated: false,
}

afterEach(() => { cleanup() })

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S {
    return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot))
  }
}

/** What a spec holds after mounting the column. */
interface Mounted {
  readonly view: RenderResult
  readonly instance: ReturnType<ReturnType<typeof createFilesStore>['create']>
  readonly script: ReturnType<typeof scriptedList>
  readonly open: ReturnType<typeof vi.fn>
  readonly channel: ReturnType<typeof createRevealChannel>
}

/** Mount the column over one store instance and a scripted listing. */
function mountExplorer(cwd: string | null = ROOT): Mounted {
  const instance = createFilesStore().create()
  const script = scriptedList()
  const open = vi.fn<(address: string) => void>()
  const channel = createRevealChannel()
  const face = explorerFace(script.list, open, channel)(SESSION, instance.actions)
  const sessions = { byId: cwd === null ? {} : { [SESSION]: { cwd } } } as unknown as SessionListState
  const view = render(<ExplorerBody
    {...{
      sessionId: SESSION,
      useSessions: <S,>(sel: (s: SessionListState) => S) => sel(sessions),
      useStore: hookOf(instance),
      actions: instance.actions,
      ...face,
      t: makeTranslate(zh),
    } as unknown as ExplorerBodyProps}
  />)
  return { view, instance, script, open, channel }
}

describe('ExplorerBody', () => {
  it('says so when the session has no workspace directory, and asks for nothing', () => {
    const { view, script } = mountExplorer(null)
    expect(view.container.querySelector('[data-files-explorer-state="no-workspace"]')?.textContent).toBe(zh.noWorkspace)
    expect(script.list).not.toHaveBeenCalled()
  })

  it('lists the session root on mount and heads it with the root\'s last segment', async () => {
    const { view, script } = mountExplorer()
    expect(script.list).toHaveBeenCalledWith(SESSION, ROOT, expect.any(AbortSignal))
    expect(view.container.querySelector('[data-files-row="loading"]')).not.toBeNull()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    const root = view.container.querySelector('[data-files-explorer-state="tree"]')
    expect(root?.getAttribute('data-files-root')).toBe(ROOT)
    expect(root?.getAttribute('aria-label')).toBe(zh['type.label'])
    const title = view.container.querySelector('[data-files-explorer-root]')
    expect(title?.textContent).toBe('app')
    expect(title?.getAttribute('title')).toBe(ROOT)
    expect([...view.container.querySelectorAll('[data-files-entry]')].map(li => li.getAttribute('data-files-path')))
      .toEqual([`${ROOT}/src`, `${ROOT}/README.md`])
  })

  it('a directory click lists that level; a file click opens through the sidebar face, not a tab', async () => {
    const { view, script, open } = mountExplorer()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    const dir = view.container.querySelector(`[data-files-path="${ROOT}/src"] > button`)!
    act(() => { fireEvent.click(dir) })
    expect(script.list).toHaveBeenLastCalledWith(SESSION, `${ROOT}/src`, expect.any(AbortSignal))
    await act(() => script.settle({ ok: true, value: { entries: [{ name: 'a.ts', type: 'file' }], truncated: false } }))
    expect(view.container.querySelector(`[data-files-path="${ROOT}/src/a.ts"]`)).not.toBeNull()
    fireEvent.click(view.container.querySelector(`[data-files-path="${ROOT}/README.md"] > button`)!)
    expect(open).toHaveBeenCalledWith(fileAddressFor(SESSION, ROOT, `${ROOT}/README.md`))
  })

  it('a reveal expands the file ancestors, lists what is missing, and highlights the row', async () => {
    const { view, script, channel, instance } = mountExplorer()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    act(() => { channel.request({ sessionId: SESSION, path: `${ROOT}/src/a.ts` }) })
    // The ancestor without a level is listed; the root is not asked again.
    expect(script.list).toHaveBeenLastCalledWith(SESSION, `${ROOT}/src`, expect.any(AbortSignal))
    await act(() => script.settle({ ok: true, value: { entries: [{ name: 'a.ts', type: 'file' }], truncated: false } }))
    expect(view.container.querySelector(`[data-files-path="${ROOT}/src/a.ts"] > button`)
      ?.getAttribute('data-files-highlighted')).not.toBeNull()
    expect(instance.getSnapshot().byTree[SESSION]?.expanded).toEqual([ROOT, `${ROOT}/src`])
  })

  it('a reveal of a path outside the workspace leaves the tree untouched', async () => {
    const { view, script, channel } = mountExplorer()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    script.list.mockClear()
    act(() => { channel.request({ sessionId: SESSION, path: '/elsewhere/a.ts' }) })
    expect(script.list).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-files-highlighted]')).toBeNull()
  })

  it('a reveal for another session is ignored by this tree', async () => {
    const { view, script, channel } = mountExplorer()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    script.list.mockClear()
    act(() => { channel.request({ sessionId: 's-other' as SessionId, path: `${ROOT}/README.md` }) })
    expect(script.list).not.toHaveBeenCalled()
    expect(view.container.querySelector('[data-files-highlighted]')).toBeNull()
  })

  it('the reveal highlight expires on its own', async () => {
    vi.useFakeTimers()
    try {
      const { view, script, channel } = mountExplorer()
      await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
      act(() => { channel.request({ sessionId: SESSION, path: `${ROOT}/README.md` }) })
      expect(view.container.querySelector('[data-files-highlighted]')).not.toBeNull()
      act(() => { vi.advanceTimersByTime(2600) })
      expect(view.container.querySelector('[data-files-highlighted]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reload lists the expanded levels again through one signal that unmounting aborts', async () => {
    const { view, script, instance } = mountExplorer()
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    act(() => { fireEvent.click(view.container.querySelector(`[data-files-path="${ROOT}/src"] > button`)!) })
    await act(() => script.settle({ ok: true, value: ROOT_LEVEL }))
    script.list.mockClear()

    act(() => { fireEvent.click(view.container.querySelector('[data-files-explorer-reload]')!) })
    expect(script.list.mock.calls.map(call => call[1])).toEqual([ROOT, `${ROOT}/src`])

    // The column owns its lifetime: leaving the panel forgets the session's tree.
    view.unmount()
    expect(instance.getSnapshot().byTree[SESSION]).toBeUndefined()
  })
})
