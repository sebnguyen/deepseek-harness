/**
 * The lifecycle owner: degrade-don't-error postures, the single live child
 * over the house subprocess seam, readiness flipping only on hello, the
 * listening line parsed off managed stdout into frameUrl, drain semantics.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { SubprocessCollectedOutputs, SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { beforeEach, describe, expect, it } from 'vitest'
import { IdeController, IDE_REPORT_CAP } from '../src/controller.ts'
import type { IdeManifestRow, IdeSubprocessLike, IdeUnpackLike } from '../src/types.ts'

const ROW: IdeManifestRow = { upstreamSha: 'f'.repeat(40), upstreamUrl: 'https://x', twins: {} }

function first<T>(list: readonly T[]): T {
  const value = list[0]
  if (value === undefined) throw new Error('empty')
  return value
}

class FakeHandle implements SubprocessHandle {
  readonly stdin = undefined
  readonly stderr = undefined
  readonly stdout: Readable | undefined
  readonly collected = {} as SubprocessCollectedOutputs
  #done!: (outcome: SubprocessOutcome) => void
  readonly done = new Promise<SubprocessOutcome>((resolve) => {
    this.#done = resolve
  })
  #waiters: Array<(empty: boolean) => void> = []
  #exited = false
  terminated = false

  constructor(withPort: boolean) {
    this.stdout = withPort ? new Readable({ read() {} }) : undefined
  }

  /** Emit the REH readiness line exactly as the agent prints it. */
  reportPort(port: number): void {
    this.stdout?.push(`Extension host agent listening on ${port}\n`)
  }

  #finish(outcome: SubprocessOutcome): void {
    this.#exited = true
    this.#done(outcome)
    for (const waiter of this.#waiters) waiter(true)
    this.#waiters = []
  }

  terminate(): void {
    this.terminated = true
    this.#finish({ exitCode: null, signal: 'SIGTERM' })
  }

  waitForExit(): Promise<boolean> {
    if (this.#exited) return Promise.resolve(true)
    return new Promise((resolve) => {
      this.#waiters.push(resolve)
    })
  }

  exit(code: number): void {
    this.stdout?.push(null)
    this.#finish({ exitCode: code, signal: null })
  }
}

class FakeSubprocess implements IdeSubprocessLike {
  spawns: SubprocessSpawnSpec[] = []
  handles: FakeHandle[] = []
  withPort = true

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.spawns.push(spec)
    const handle = new FakeHandle(this.withPort)
    this.handles.push(handle)
    return handle
  }
}

let root: string
let twinDir: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ide-ctl-'))
  twinDir = join(root, 'twin')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(twinDir, { recursive: true })
  await writeFile(join(twinDir, 'reh-server'), 's')
  await writeFile(join(twinDir, 'web-client'), 'c')
})

/** The tar seam for specs: extract means “place the entry the spawn expects”. */
const fakeUnpack: IdeUnpackLike = async (_command, args) => {
  const destination = args[args.indexOf('-C') + 1]
  if (destination === undefined) throw new Error('no -C')
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(destination, { recursive: true })
  if (destination.endsWith('server')) await writeFile(join(destination, 'server.js'), '')
}

function controller(subprocess?: FakeSubprocess, withTwin = false): IdeController {
  return new IdeController({
    loadRow: async () => ROW,
    env: withTwin ? { DSH_IDE_TWIN_DIR: twinDir, DSH_IDE_TWIN_NOVERIFY: '1' } : {},
    cacheDir: '/definitely/absent',
    subprocess,
    unpack: fakeUnpack,
  })
}

describe('IdeController', () => {
  it('degrades to no-twin without a twin or a subprocess seam', async () => {
    expect((await controller(new FakeSubprocess()).ensure()).reason).toBe('no-twin')
    const noSub = controller()
    expect((await noSub.ensure()).twinSha).toBeNull()
    expect(noSub.status.reason).toBe('no-twin')
  })

  it('degrades to no-twin with a twin but no subprocess seam', async () => {
    const noSub = controller(undefined, true)
    const status = await noSub.ensure()
    expect(status.twinSha).toBe(ROW.upstreamSha)
    expect(status.reason).toBe('no-twin')
  })

  it('spawns once through the seam, parses the listening line into frameUrl, flips on hello only', async () => {
    const sub = new FakeSubprocess()
    const ctl = controller(sub, true)
    const seen: boolean[] = []
    const off = ctl.subscribe((status) => {
      seen.push(status.ready)
    })
    expect(seen).toEqual([false])
    await ctl.ensure()
    const spec = first(sub.spawns)
    expect(sub.spawns).toHaveLength(1)
    expect(first(spec.argv)).toBe(process.execPath)
    expect(spec.argv).toContain('--port')
    expect(spec.stdio.stdout).toBe('pipe')
    expect(ctl.status.reason).toBe('spawning')
    expect(ctl.hello()).toBe(true)
    expect(ctl.status.ready).toBe(true)
    // A non-matching preamble chunk and an over-cap burst exercise the tail
    // trim before the listening line lands.
    first(sub.handles).stdout?.push('noise preamble\n')
    first(sub.handles).stdout?.push(`x${'y'.repeat(9_000)}z\n`)
    first(sub.handles).reportPort(41000)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctl.status.frameUrl).toContain('127.0.0.1:41000')
    expect(ctl.launchToken).toBeDefined()
    expect(ctl.status.frameUrl).toContain(ctl.launchToken ?? '')
    await ctl.ensure()
    expect(sub.spawns).toHaveLength(1)
    expect(seen.at(-1)).toBe(true)
    off()
  })

  it('runs the no-stdout spawn path and refuses hello without a child', async () => {
    const sub = new FakeSubprocess()
    sub.withPort = false
    const ctl = controller(sub, true)
    expect(controller().hello()).toBe(false)
    await ctl.ensure()
    expect(ctl.status.frameUrl).toBeNull()
  })

  it('drops to no-twin when the child exits and respawns on the next ensure', async () => {
    const sub = new FakeSubprocess()
    const ctl = controller(sub, true)
    await ctl.ensure()
    first(sub.handles).exit(1)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctl.status.reason).toBe('no-twin')
    await ctl.ensure()
    expect(sub.spawns).toHaveLength(2)
  })

  it('ignores a stale port report after a child change', async () => {
    const sub = new FakeSubprocess()
    const ctl = controller(sub, true)
    await ctl.ensure()
    const firstHandle = first(sub.handles)
    await ctl.dispose()
    expect(ctl.status.reason).toBe('disposed')
    firstHandle.reportPort(1)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctl.status.frameUrl).toBeNull()
    await ctl.ensure()
    expect(ctl.status.reason).toBe('spawning')
    const live = sub.handles.at(-1)
    if (live === undefined) throw new Error('no live child')
    live.reportPort(41001)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctl.status.frameUrl).toContain('127.0.0.1:41001')
  })

  it('forwards the gateway and session env facts when composed', async () => {
    const sub = new FakeSubprocess()
    const ctl = new IdeController({
      loadRow: async () => ROW,
      env: { DSH_IDE_TWIN_DIR: twinDir, DSH_IDE_TWIN_NOVERIFY: '1', DSH_SESSION_ID: 's1' },
      cacheDir: root,
      subprocess: sub,
      unpack: fakeUnpack,
      gatewayUrl: () => 'http://127.0.0.1:7200',
    })
    await ctl.ensure()
    const spec = first(sub.spawns)
    expect(spec.env?.DSH_GATEWAY_URL).toBe('http://127.0.0.1:7200')
    expect(spec.env?.DSH_SESSION_ID).toBe('s1')
    expect(spec.env?.DSH_IDE_TOKEN).toBe(ctl.launchToken)
  })

  it('admits the launch token through the compose seam and revokes it on dispose', async () => {
    const sub = new FakeSubprocess()
    const admitted: string[] = []
    let revoked = 0
    const ctl = new IdeController({
      loadRow: async () => ROW,
      env: { DSH_IDE_TWIN_DIR: twinDir, DSH_IDE_TWIN_NOVERIFY: '1' },
      cacheDir: root,
      subprocess: sub,
      unpack: fakeUnpack,
      admit: (token) => {
        admitted.push(token)
        return () => {
          revoked += 1
        }
      },
    })
    await ctl.ensure()
    expect(admitted).toEqual([ctl.launchToken])
    expect(revoked).toBe(0)
    await ctl.dispose()
    expect(revoked).toBe(1)
  })

  it('drains the pending open queue one entry at a time', async () => {
    const ctl = controller()
    ctl.open('a.ts')
    ctl.open('b.ts')
    expect(ctl.takeOpen()).toBe('a.ts')
    expect(ctl.takeOpen()).toBe('b.ts')
    expect(ctl.takeOpen()).toBeNull()
  })

  it('caps the report journal at the bound', async () => {
    const ctl = controller()
    for (let index = 0; index < IDE_REPORT_CAP + 5; index++) ctl.report({ kind: 'save', path: `f${index}`, detail: null })
    const reports = ctl.reports()
    expect(reports).toHaveLength(IDE_REPORT_CAP)
    expect(first(reports).path).toBe('f5')
  })

  it('exposes the row and twin after a resolved ensure, and disposes cold', async () => {
    const sub = new FakeSubprocess()
    const ctl = controller(sub, true)
    await ctl.ensure()
    expect(ctl.row?.upstreamSha).toBe(ROW.upstreamSha)
    expect(ctl.twin?.platform).toBe('override')
    await controller().dispose()
  })
})
