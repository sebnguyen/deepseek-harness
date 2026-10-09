/**
 * The lifecycle owner: degrade-don't-error postures, the single live child,
 * readiness flipping only on hello, port-driven frameUrl, and drain semantics.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { IdeController } from '../src/controller.ts'
import type { IdeChildLike, IdeManifestRow, IdeSpawnLike } from '../src/types.ts'

const ROW: IdeManifestRow = { upstreamSha: 'f'.repeat(40), upstreamUrl: 'https://x', twins: {} }

class FakeChild implements IdeChildLike {
  exitedResolve!: (code: number | null) => void
  exited = new Promise<number | null>((resolve) => {
    this.exitedResolve = resolve
  })

  portResolve?: (port: number) => void
  port?: Promise<number>
  killed = false

  constructor(withPort: boolean) {
    if (withPort) {
      this.port = new Promise<number>((resolve) => {
        this.portResolve = resolve
      })
    }
  }

  async kill(): Promise<void> {
    this.killed = true
    this.exitedResolve(null)
  }
}

class FakeSubprocess implements IdeSpawnLike {
  spawns: Array<{ readonly command: string; readonly args: readonly string[] }> = []
  children: FakeChild[] = []
  withPort = true

  spawn(options: { readonly command: string; readonly args: readonly string[] }): IdeChildLike {
    this.spawns.push(options)
    const child = new FakeChild(this.withPort)
    this.children.push(child)
    return child
  }
}

async function seededTwinDir(root: string): Promise<string> {
  const dir = join(root, 'twin')
  await writeFile(join(dir.replace(/\/$/, ''), '.keep'), '').catch(() => {})
  return dir
}

let root: string
let twinDir: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ide-ctl-'))
  twinDir = join(root, 'twin')
  await writeFile(join(root, 'r'), '')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(twinDir, { recursive: true })
  await writeFile(join(twinDir, 'reh-server'), 's')
  await writeFile(join(twinDir, 'web-client'), 'c')
})

function controller(subprocess?: FakeSubprocess, withTwin = false): IdeController {
  return new IdeController({
    loadRow: async () => ROW,
    env: withTwin ? { DSH_IDE_TWIN_DIR: twinDir, DSH_IDE_TWIN_NOVERIFY: '1' } : {},
    cacheDir: '/definitely/absent',
    subprocess,
  })
}

describe('IdeController', () => {
  it('degrades to no-twin without a twin or a subprocess seam', async () => {
    expect((await controller(new FakeSubprocess()).ensure()).reason).toBe('no-twin')
    const noSub = controller()
    expect((await noSub.ensure()).twinSha).toBeUndefined()
    expect(noSub.status.reason).toBe('no-twin')
  })

  it('degrades to no-twin with a twin but no subprocess seam', async () => {
    const noSub = controller(undefined, true)
    const status = await noSub.ensure()
    expect(status.twinSha).toBe(ROW.upstreamSha)
    expect(status.reason).toBe('no-twin')
  })

  it('spawns once, reports the port as frameUrl, flips on hello only', async () => {
    const sub = new FakeSubprocess()
    const ctl = controller(sub, true)
    const seen: boolean[] = []
    const off = ctl.subscribe((status) => {
      seen.push(status.ready)
    })
    expect(seen).toEqual([false])
    await ctl.ensure()
    expect(sub.spawns).toHaveLength(1)
    expect(sub.spawns[0]!.args).toContain('--port')
    expect(ctl.status.reason).toBe('spawning')
    expect(ctl.hello()).toBe(true)
    expect(ctl.status.ready).toBe(true)
    sub.children[0]!.portResolve!(41000)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctl.status.frameUrl).toContain('127.0.0.1:41000')
    expect(ctl.status.frameUrl).toContain(ctl.launchToken!)
    await ctl.ensure()
    expect(sub.spawns).toHaveLength(1)
    expect(seen.at(-1)).toBe(true)
    off()
  })

  it('runs the no-port spawn path and refuses hello without a child', async () => {
    const sub = new FakeSubprocess()
    sub.withPort = false
    const ctl = controller(sub, true)
    expect(controller().hello()).toBe(false)
    await ctl.ensure()
    expect(ctl.status.frameUrl).toBeUndefined()
  })

  it('drops to no-twin when the child exits and respawns on the next ensure', async () => {
    const sub = new FakeSubprocess()
    const ctl = controller(sub, true)
    await ctl.ensure()
    const first = sub.children[0]!
    first.exitedResolve(1)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctl.status.reason).toBe('no-twin')
    await ctl.ensure()
    expect(sub.spawns).toHaveLength(2)
  })

  it('ignores a stale port report after a child change', async () => {
    const sub = new FakeSubprocess()
    const ctl = controller(sub, true)
    await ctl.ensure()
    const first = sub.children[0]!
    await ctl.dispose()
    expect(ctl.status.reason).toBe('disposed')
    first.portResolve!(1)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(ctl.status.frameUrl).toBeUndefined()
  })

  it('drains the pending open queue exactly once', async () => {
    const ctl = controller()
    ctl.open('a.ts')
    ctl.open('b.ts')
    expect(ctl.takePendingOpens()).toEqual(['a.ts', 'b.ts'])
    expect(ctl.takePendingOpens()).toEqual([])
    void seededTwinDir
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
