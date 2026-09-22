// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { TemperatureSlider } from '../src/client/TemperatureSlider.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof TemperatureSlider>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash', temperature: 0.2 },
    routable: true,
    groups: [],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('TemperatureSlider', () => {
  it('loads the shared directory when the seat is available', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const load = vi.fn()
    render(<TemperatureSlider locked={false} available directory={directory} load={load} select={vi.fn()} t={t} />)
    expect(load).toHaveBeenCalledOnce()
  })

  it('renders nothing for sessions without model selection', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    render(<TemperatureSlider locked={false} available={false} directory={directory} load={vi.fn()} select={vi.fn()} t={t} />)
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('renders the current temperature and submits the full selection with a new value', async () => {
    vi.useFakeTimers()
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: {
        provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'high', temperature: 0.2,
      },
    }))
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<TemperatureSlider locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)

    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.value).toBe('0.2')
    expect(slider.getAttribute('aria-label')).toBe('采样温度')
    expect(slider.disabled).toBe(false)

    fireEvent.change(slider, { target: { value: '0.7' } })
    await vi.advanceTimersByTimeAsync(120)
    expect(select).toHaveBeenCalledWith({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
      temperature: 0.7,
    })
    vi.useRealTimers()
  })

  it('shows the fallback default and omits effort when the selection carries neither', async () => {
    vi.useFakeTimers()
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: { provider: 'p', model: 'm' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<TemperatureSlider locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)

    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.value).toBe('0.2')

    fireEvent.change(slider, { target: { value: '0.05' } })
    await vi.advanceTimersByTimeAsync(120)
    expect(select).toHaveBeenCalledWith({ provider: 'p', model: 'm', temperature: 0.05 })
    vi.useRealTimers()
  })

  it('disables while locked or unresolved, but stays draggable during selectModel', () => {
    const locked = createSnapshotStore<ModelDirectoryState>(state())
    render(<TemperatureSlider locked available directory={locked} load={vi.fn()} select={vi.fn()} t={t} />)
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true)

    cleanup()
    const pending = createSnapshotStore<ModelDirectoryState>(state({ current: null }))
    render(<TemperatureSlider locked={false} available directory={pending} load={vi.fn()} select={vi.fn()} t={t} />)
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true)

    cleanup()
    const selecting = createSnapshotStore<ModelDirectoryState>(state({ status: 'selecting' }))
    render(<TemperatureSlider locked={false} available directory={selecting} load={vi.fn()} select={vi.fn()} t={t} />)
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(false)
  })

  it('updates immediately on change and commits after the drag settles', async () => {
    vi.useFakeTimers()
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn().mockResolvedValue(true)
    render(<TemperatureSlider locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)

    const slider = screen.getByRole('slider') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '0.55' } })
    expect(slider.value).toBe('0.55')
    expect(select).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(120)
    expect(select).toHaveBeenCalledWith({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      temperature: 0.55,
    })
    vi.useRealTimers()
  })

  it('commits immediately on pointer up without waiting for the debounce', () => {
    vi.useFakeTimers()
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn().mockResolvedValue(true)
    render(<TemperatureSlider locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)

    const slider = screen.getByRole('slider') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '0.4' } })
    fireEvent.pointerUp(slider)
    expect(select).toHaveBeenCalledWith({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      temperature: 0.4,
    })
    vi.useRealTimers()
  })

  it('ignores a change when no selection is resolved', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({ current: null }))
    const select = vi.fn().mockResolvedValue(true)
    render(<TemperatureSlider locked={false} available directory={directory} load={vi.fn()} select={select} t={t} />)

    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.5' } })
    expect(select).not.toHaveBeenCalled()
  })
})
