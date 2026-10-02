// @vitest-environment jsdom
/**
 * StepPaceSlider seat behavior over a driven directory store, plus the
 * directory's setPace wire verb: whole-millisecond commit, shared-folder
 * readback, failure surfacing, and subagent-session denial.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StepPaceProjectionState } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionSetStepPaceRequest, SessionSetStepPaceValue } from '@deepseek-ai/dsh-api-session-controller/types'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ModelCatalogDirectory } from '../src/client/catalog.ts'
import type { ComponentProps } from 'react'
import { ModelDirectory, type ModelDirectoryState } from '../src/client/directory.ts'
import { StepPaceSlider } from '../src/client/StepPaceSlider.tsx'
import { zh } from '../src/client/locales.ts'

// The seat's key domain is the model dictionary; the stub mirrors the real
// lookup chain with a missing-key fallback to the key itself.
const t: ComponentProps<typeof StepPaceSlider>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function paceState(overrides: Partial<StepPaceProjectionState> = {}): StepPaceProjectionState {
  return { ms: 2000, lastStepStartAt: null, ...overrides }
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [],
    failures: [],
    status: 'ready',
    error: null,
    pace: paceState(),
    ...overrides,
  }
}

afterEach(cleanup)

describe('StepPaceSlider', () => {
  it('renders nothing for sessions without model selection', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    render(<StepPaceSlider locked={false} available={false} directory={directory} setPace={vi.fn()} t={t} />)
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('shows the persisted pace and commits whole milliseconds after the drag settles', async () => {
    vi.useFakeTimers()
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const setPace = vi.fn(async (ms: number) => {
      directory.set(state({ pace: { ms, lastStepStartAt: null } }))
      return true
    })
    render(<StepPaceSlider locked={false} available directory={directory} setPace={setPace} t={t} />)

    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.value).toBe('2')
    expect(slider.getAttribute('aria-label')).toBe('步骤间隔')
    expect(slider.disabled).toBe(false)

    fireEvent.change(slider, { target: { value: '3.5' } })
    expect(screen.getByText('3.5s')).not.toBeNull()
    expect(setPace).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(120)
    expect(setPace).toHaveBeenCalledWith(3500)
    vi.useRealTimers()
  })

  it('commits immediately on pointer release and shows zero before any selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({ pace: null }))
    const setPace = vi.fn().mockResolvedValue(true)
    render(<StepPaceSlider locked={false} available directory={directory} setPace={setPace} t={t} />)

    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.value).toBe('0')
    fireEvent.change(slider, { target: { value: '1.5' } })
    fireEvent.pointerUp(slider, { target: { value: '1.5' } })
    expect(setPace).toHaveBeenCalledWith(1500)
  })

  it('coalesces rapid drags into one commit and lets an unmount cancel a pending one', async () => {
    vi.useFakeTimers()
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const setPace = vi.fn().mockResolvedValue(true)
    render(<StepPaceSlider locked={false} available directory={directory} setPace={setPace} t={t} />)
    const slider = screen.getByRole('slider') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '2.5' } })
    fireEvent.change(slider, { target: { value: '3' } })
    await vi.advanceTimersByTimeAsync(120)
    expect(setPace).toHaveBeenCalledExactlyOnceWith(3000)
    // A pending commit is cancelled by unmount.
    fireEvent.change(slider, { target: { value: '5' } })
    cleanup()
    await vi.advanceTimersByTimeAsync(500)
    expect(setPace).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('ignores a pointer up fired without a pending drag', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const setPace = vi.fn().mockResolvedValue(true)
    render(<StepPaceSlider locked={false} available directory={directory} setPace={setPace} t={t} />)
    fireEvent.pointerUp(screen.getByRole('slider'))
    expect(setPace).not.toHaveBeenCalled()
  })

  it('disables while locked and tracks the committed draft', async () => {
    vi.useFakeTimers()
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    render(<StepPaceSlider locked available directory={directory} setPace={vi.fn()} t={t} />)
    expect(screen.getByRole('slider').hasAttribute('disabled')).toBe(true)
    cleanup()

    const store = createSnapshotStore<ModelDirectoryState>(state())
    const setPace = vi.fn(async (ms: number) => {
      store.set(state({ pace: { ms, lastStepStartAt: null } }))
      return true
    })
    render(<StepPaceSlider locked={false} available directory={store} setPace={setPace} t={t} />)
    fireEvent.change(screen.getByRole('slider'), { target: { value: '4' } })
    await vi.advanceTimersByTimeAsync(120)
    expect(setPace).toHaveBeenCalledWith(4000)
    expect(screen.getByText('4.0s')).not.toBeNull()
    vi.useRealTimers()
  })
})

describe('ModelDirectory.setPace', () => {
  type SetStepPace = (request: SessionSetStepPaceRequest) => Promise<RemoteResult<SessionSetStepPaceValue>>
  function setStepPaceMock(impl: SetStepPace) {
    return vi.fn(impl)
  }

  function directoryOf(setStepPace: ReturnType<typeof setStepPaceMock>, available: () => boolean = () => true): ModelDirectory {
    const catalog = {
      store: createSnapshotStore({
        status: 'ready',
        value: { default: { provider: 'p', model: 'm' }, routableProviders: ['p'], groups: [], failures: [] },
        error: null,
      }),
      load: vi.fn(),
    } as unknown as ModelCatalogDirectory
    const face: ObservableSnapshot<unknown> = {
      getSnapshot: () => ({ lastUsed: null, next: null }),
      subscribe: () => () => {},
    }
    return new ModelDirectory(
      { setStepPace, selectModel: vi.fn() },
      SessionId('pace-test'),
      available,
      catalog,
      face,
      face,
    )
  }

  it('persists whole milliseconds through the session RPC', async () => {
    const setStepPace = setStepPaceMock(async request => ({ ok: true, value: { ms: request.ms } }))
    const directory = directoryOf(setStepPace)
    await directory.setPace(2500)
    expect(setStepPace).toHaveBeenCalledWith({ sessionId: SessionId('pace-test'), ms: 2500 })
  })

  it('throws the wire failure for rejected paces', async () => {
    const setStepPace = setStepPaceMock(async () => ({
      ok: false,
      error: new RemoteError('gateway/bad-request', 'step pace must be a whole number of milliseconds', {}),
    }))
    const directory = directoryOf(setStepPace)
    await expect(directory.setPace(-5)).rejects.toThrow('session.setStepPace failed')
  })

  it('rejects for addressed subagent sessions without reaching the wire', async () => {
    const setStepPace = setStepPaceMock(async request => ({ ok: true, value: { ms: request.ms } }))
    const directory = directoryOf(setStepPace, () => false)
    await expect(directory.setPace(1000)).rejects.toThrow('unavailable')
    expect(setStepPace).not.toHaveBeenCalled()
  })
})
