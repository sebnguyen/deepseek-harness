/**
 * The `ide` Remote namespace against a real Cordis Context: registration under
 * its key, named refusals riding RemoteError, and the event stream's liveness.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Ide, { IdeController } from '../src/index.ts'
import type { IdeChildLike, IdeSpawnLike } from '../src/types.ts'

/** The house lib target lacks AbortSignal.none; a controller that is never aborted is the never-ending idiom. */
const unAborting = new AbortController().signal

class StubChild implements IdeChildLike {
  exitedResolve!: (code: number | null) => void
  exited = new Promise<number | null>((resolve) => {
    this.exitedResolve = resolve
  })

  portResolve?: (port: number) => void
  port?: Promise<number>

  constructor() {
    this.port = new Promise<number>((resolve) => {
      this.portResolve = resolve
    })
  }

  async kill(): Promise<void> {
    this.exitedResolve(null)
  }
}

class StubSubprocess implements IdeSpawnLike {
  children: StubChild[] = []

  spawn(): IdeChildLike {
    const child = new StubChild()
    this.children.push(child)
    return child
  }
}

let home: string
let manifestPath: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ide-home-'))
  manifestPath = join(home, 'manifest.json')
  vi.stubEnv('DSH_IDE_MANIFEST', manifestPath)
  vi.stubEnv('DSH_IDE_CACHE_DIR', join(home, 'cache'))
})
afterEach(() => {
  vi.unstubAllEnvs()
})

async function writeManifest(twins: object = {}): Promise<void> {
  await writeFile(manifestPath, JSON.stringify({ upstreamSha: 'e'.repeat(40), upstreamUrl: 'https://github.com/microsoft/vscode.git', twins }))
}

function boot(subprocess?: StubSubprocess): Ide {
  const ctx = new Context()
  if (subprocess !== undefined) ctx.provide('subprocess', subprocess as never)
  const service = new Ide(ctx)
  expect(service.name).toBe('ide')
  return service
}

describe('ide Remote namespace', () => {
  it('reports the frame-absent posture without a twin', async () => {
    await writeManifest()
    const service = boot(new StubSubprocess())
    const status = await service.status(unAborting)
    expect(status).toMatchObject({ ready: false, reason: 'no-twin' })
  })

  it('refuses loud through RemoteError when the manifest is broken', async () => {
    await writeFile(manifestPath, '{')
    const service = boot()
    service.start()
    await new Promise(resolve => setTimeout(resolve, 15))
    const refusal = await service.status(unAborting).then(() => undefined, (error: unknown) => error)
    expect(refusal).toBeInstanceOf(RemoteError)
    expect((refusal as RemoteError).code).toBe('ide/manifest-invalid')
    // open() rides the same refusal once the startup error is latched.
    const openRefusal = await service.open('a.ts', unAborting).then(() => undefined, (error: unknown) => error)
    expect((openRefusal as RemoteError).code).toBe('ide/manifest-invalid')
  })

  it('rethrows non-artifact startup failures unchanged', async () => {
    vi.stubEnv('DSH_IDE_MANIFEST', join(home, 'absent.json'))
    const service = boot()
    await expect(service.status(unAborting)).rejects.toThrow('ENOENT')
  })

  it('streams readiness: first snapshot, then the hello change, then abort', async () => {
    const platform = `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`
    const twinDir = join(home, 'twin')
    await writeFile(join(home, 'm2.json'), '')
    vi.stubEnv('DSH_IDE_MANIFEST', manifestPath)
    await writeManifest({})
    vi.stubEnv('DSH_IDE_TWIN_DIR', twinDir)
    vi.stubEnv('DSH_IDE_TWIN_NOVERIFY', '1')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(twinDir, { recursive: true })
    await writeFile(join(twinDir, 'reh-server'), 's')
    await writeFile(join(twinDir, 'web-client'), 'c')
    void join(home, 'm2.json')
    const sub = new StubSubprocess()
    const service = boot(sub)
    service.start()
    await new Promise(resolve => setTimeout(resolve, 10))
    const controllerAbort = new AbortController()
    const iterable = service.events(controllerAbort.signal)
    const iterator = iterable[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.value?.ready).toBe(false)
    const nextParked = iterator.next()
    // Mirror the bridge hello through the controller the service owns.
    const ideControllerProbe = service as unknown as { hello(signal: AbortSignal): Promise<boolean> }
    expect(await ideControllerProbe.hello(unAborting)).toBe(true)
    const changed = await nextParked
    expect(changed.value?.ready).toBe(true)
    controllerAbort.abort()
    const done = await iterator.next()
    expect(done.done).toBe(true)
    expect(await iterator.return?.()).toMatchObject({ done: true })
    void platform
  })

  it('queues opens into the downlink and nudges the spawn', async () => {
    await writeManifest()
    const sub = new StubSubprocess()
    const service = boot(sub)
    await service.open('packages/host/ide/src/index.ts', unAborting)
    // No twin on the cold manifest: nothing spawns, the queue stays for the bridge.
    expect(sub.children).toHaveLength(0)
    // openNext drains the downlink FIFO and empties to undefined.
    expect(await service.openNext(unAborting)).toBe('packages/host/ide/src/index.ts')
    expect(await service.openNext(unAborting)).toBeUndefined()
  })

  it('round-trips bridge event-uplink reports under the Host cap', async () => {
    await writeManifest()
    const service = boot()
    await service.report('save', 'a.ts', 'v2', unAborting)
    await service.report('activeEditor', 'b.ts', undefined, unAborting)
    await service.report('diagnostics', undefined, '0 problems', unAborting)
    expect(await service.reports(unAborting)).toEqual([
      { kind: 'save', path: 'a.ts', detail: 'v2' },
      { kind: 'activeEditor', path: 'b.ts', detail: undefined },
      { kind: 'diagnostics', path: undefined, detail: '0 problems' },
    ])
  })

  it('exposes the controller surface to the Host composition', () => {
    expect(IdeController).toBeTypeOf('function')
  })

  it('routes the env fallbacks through the pure path helpers', async () => {
    const { defaultCacheDir, manifestPathOf } = await import('../src/index.ts')
    expect(defaultCacheDir({ DSH_IDE_CACHE_DIR: '/c' })).toBe('/c')
    expect(defaultCacheDir({ HOME: '/h' })).toBe('/h/.cache/dsh/ide')
    expect(defaultCacheDir({})).toBe('/tmp/.cache/dsh/ide')
    expect(manifestPathOf({ DSH_IDE_MANIFEST: '/m.json' }, '/w')).toBe('/m.json')
    expect(manifestPathOf({}, '/w')).toContain('scripts/ide/manifest.default.json')
  })

  it('replays the class-plugin init symbol as a warm start', async () => {
    const { Service } = await import('@deepseek-ai/cordis')
    await writeManifest()
    const service = boot(new StubSubprocess())
    const init = (service as unknown as Record<typeof Service.init, (this: Ide) => void>)[Service.init]
    init.call(service)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect((await service.status(unAborting)).reason).toBe('no-twin')
  })

  it('reports done when the stream is aborted while parked', async () => {
    await writeManifest()
    const service = boot()
    const aborter = new AbortController()
    const iterator = service.events(aborter.signal)[Symbol.asyncIterator]()
    await iterator.next()
    const parked = iterator.next()
    await new Promise(resolve => setTimeout(resolve, 0))
    aborter.abort()
    expect((await parked).done).toBe(true)
  })

  it('swallows non-artifact startup failures and latches artifact ones', async () => {
    // Non-artifact startup failure: start swallows, status still re-raises fresh.
    vi.stubEnv('DSH_IDE_MANIFEST', join(home, 'nope.json'))
    const swallowed = boot()
    swallowed.start()
    await new Promise(resolve => setTimeout(resolve, 20))
    await expect(swallowed.status(unAborting)).rejects.toThrow('ENOENT')
    // Artifact startup failure: once settled, status rides the latched error.
    vi.stubEnv('DSH_IDE_MANIFEST', manifestPath)
    await writeFile(manifestPath, '{')
    const latched = boot()
    latched.start()
    let code: string | undefined
    for (let i = 0; i < 40; i++) {
      code = await latched.status(unAborting).then(
        () => undefined,
        (error: unknown) => (error instanceof RemoteError ? error.code : undefined),
      )
      if (code === 'ide/manifest-invalid') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(code).toBe('ide/manifest-invalid')
  })
})
