import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CordisRuntimeTree } from '@deepseek-ai/dsh-experimental-inspector/client'
import { createInspectorTreeSource } from '../src/client/tree-source.ts'

const EMPTY_TREE: CordisRuntimeTree = { schemaVersion: 1, host: null, clients: [] }
const HOST_TREE: CordisRuntimeTree = {
  schemaVersion: 1,
  host: {
    source: { sourceId: 'host-test' as never, kind: 'host', label: 'Host' },
    connection: { state: 'connected' },
    revision: 1,
    truncated: false,
    root: { kind: 'context', children: [] },
  },
  clients: [],
}

afterEach(() => { vi.useRealTimers() })

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

describe('Inspector tree source', () => {
  it('reads only while subscribed, polls after settlement, and keeps unchanged snapshots stable', async () => {
    vi.useFakeTimers()
    const read = vi.fn(async () => HOST_TREE)
    const source = createInspectorTreeSource(read, 1_000)
    expect(read).not.toHaveBeenCalled()
    expect(source.getSnapshot()).toEqual({ tree: null, read: false })

    const firstListener = vi.fn()
    const secondListener = vi.fn()
    const stopFirst = source.subscribe(firstListener)
    const stopSecond = source.subscribe(secondListener)
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledOnce()
    expect(source.getSnapshot()).toEqual({ tree: HOST_TREE, read: true })
    expect(firstListener).toHaveBeenCalledOnce()
    expect(secondListener).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(firstListener).toHaveBeenCalledOnce()
    stopFirst()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(read).toHaveBeenCalledTimes(3)
    stopSecond()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(read).toHaveBeenCalledTimes(3)

    source.dispose()
    source.dispose()
    source.refresh()
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('coalesces explicit reads and schedules the next read only after settlement', async () => {
    let resolve: ((tree: CordisRuntimeTree) => void) | undefined
    const read = vi.fn()
      .mockImplementationOnce(() => new Promise<CordisRuntimeTree>((answer) => { resolve = answer }))
      .mockResolvedValue(HOST_TREE)
    const source = createInspectorTreeSource(read, 10)
    source.refresh()
    source.refresh()
    source.refresh()
    await settle()
    expect(read).toHaveBeenCalledOnce()

    resolve?.(HOST_TREE)
    await settle()
    source.refresh()
    await settle()
    expect(read).toHaveBeenCalledTimes(2)
    source.dispose()
  })

  it('keeps the last good tree after a failed read and clears the error after recovery', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(HOST_TREE)
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce(HOST_TREE)
    const source = createInspectorTreeSource(read, 1_000)
    source.refresh()
    await settle()
    expect(source.getSnapshot()).toEqual({ tree: HOST_TREE, read: true })

    source.refresh()
    await settle()
    expect(source.getSnapshot()).toEqual({ tree: HOST_TREE, read: true, error: 'socket closed' })
    source.refresh()
    await settle()
    expect(source.getSnapshot()).toEqual({ tree: HOST_TREE, read: true })
    source.dispose()
  })

  it('reports non-Error rejections verbatim', async () => {
    const source = createInspectorTreeSource(() => Promise.reject('offline'), 1_000)
    source.refresh()
    await settle()
    expect(source.getSnapshot()).toEqual({ tree: null, read: false, error: 'offline' })
    source.dispose()
  })

  it('ignores an outstanding result after its subscriber generation closes', async () => {
    const reads: Array<(tree: CordisRuntimeTree) => void> = []
    const source = createInspectorTreeSource(
      () => new Promise<CordisRuntimeTree>((resolve) => { reads.push(resolve) }),
      1_000,
    )
    let stop = source.subscribe(vi.fn())
    await settle()
    expect(reads).toHaveLength(1)
    stop()

    stop = source.subscribe(vi.fn())
    await settle()
    expect(reads).toHaveLength(2)
    reads[0]?.(EMPTY_TREE)
    await settle()
    expect(source.getSnapshot()).toEqual({ tree: null, read: false })

    reads[1]?.(HOST_TREE)
    await settle()
    expect(source.getSnapshot()).toEqual({ tree: HOST_TREE, read: true })
    stop()
    source.dispose()
  })

  it('ignores settlement after disposal and never restarts its timer', async () => {
    vi.useFakeTimers()
    let resolve: ((tree: CordisRuntimeTree) => void) | undefined
    const read = vi.fn(() => new Promise<CordisRuntimeTree>((answer) => { resolve = answer }))
    const listener = vi.fn()
    const source = createInspectorTreeSource(read, 1_000)
    source.subscribe(listener)
    await vi.advanceTimersByTimeAsync(0)
    source.dispose()
    resolve?.(HOST_TREE)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(read).toHaveBeenCalledOnce()
    expect(listener).not.toHaveBeenCalled()
    expect(source.getSnapshot()).toEqual({ tree: null, read: false })
  })
})
