/**
 * Host half of the embedded VS Code REH editor frame: owns the manifest row
 * load, the twin artifact resolution, the loopback REH spawn with its
 * per-launch token, and the `ide` Remote namespace the web client's `ui-vscode`
 * tab kind and the dsh-bridge extension share.
 *
 * The spawn rides `ctx.subprocess` when the composition provides it and never
 * errors the product when absent: a frame-less deployment is this namespace
 * reporting `ready: false` forever, which is exactly the editor-foundation
 * note's M1 posture.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { IdeController } from './controller.ts'
import { parseManifest } from './manifest.ts'
import { IdeArtifactError, type IdeReport, type IdeSpawnLike, type IdeStatus } from './types.ts'

export { IdeController } from './controller.ts'
export { IDE_PLATFORM, parseManifest, resolveTwin, sha256OfFile } from './manifest.ts'
export * from './types.ts'

/** Repository-relative home of the manifest row the lane and the Host agree on. */
export const IDE_MANIFEST_DEFAULT_PATH = 'scripts/ide/manifest.default.json'

/**
 * The artifact cache root: the explicit env wins, otherwise the standard
 * XDG-free `~/.cache/dsh/ide` shape, with `/tmp` when no home is set.
 * @param env - the spawn environment, read for the two keys only.
 * @returns the absolute cache root.
 */
export function defaultCacheDir(env: Readonly<Record<string, string | undefined>>): string {
  return env.DSH_IDE_CACHE_DIR ?? join(env.HOME ?? '/tmp', '.cache', 'dsh', 'ide')
}

/**
 * The manifest row path this Host reads.
 * @param env - the spawn environment, read for the override only.
 * @param cwd - the Host's working directory for the repository default.
 * @returns the absolute manifest path.
 */
export function manifestPathOf(env: Readonly<Record<string, string | undefined>>, cwd: string): string {
  return env.DSH_IDE_MANIFEST ?? join(cwd, IDE_MANIFEST_DEFAULT_PATH)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `ide` Remote namespace: frame spawn, token, readiness. */
    ide: Ide
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The manifest row failed a shape check; nothing spawns. */
    'ide/manifest-invalid': { readonly detail: string }
    /** A twin directory names itself but holds only one half. */
    'ide/twin-incomplete': { readonly detail: string }
    /** The manifest records no twin for this platform to verify against. */
    'ide/twin-unrecorded': { readonly detail: string }
    /** Twin digests disagree with the manifest; spawn refused. */
    'ide/sha-mismatch': { readonly detail: string }
  }
}

/**
 * The `ide` Remote namespace. `status` is the unary the tab kind's `canOpen`
 * rides on cold open, `events` keeps it live, `open` enqueues into the bridge
 * downlink, and `hello` is what the bridge extension calls once its ext-host
 * is up and has scrubbed its env.
 */
export default class Ide extends TypertRemoteService {
  static provide = 'ide'

  #controller: IdeController
  #startupError: IdeArtifactError | undefined

  constructor(ctx: Context) {
    super(ctx, 'ide')
    this.#controller = new IdeController({
      loadRow: async () => parseManifest(await readFile(this.#manifestPath(), 'utf8')),
      env: process.env,
      cacheDir: defaultCacheDir(process.env),
      subprocess: (ctx as { subprocess?: IdeSpawnLike }).subprocess,
    })
  }

  #manifestPath(): string {
    return manifestPathOf(process.env, process.cwd())
  }

  /** Kick one ensure after construction; a startup refusal is re-raised by the verbs. */
  start(): void {
    void this.#controller.ensure().catch((error: unknown) => {
      if (error instanceof IdeArtifactError) this.#startupError = error
    })
  }

  #refuse(error: unknown): never {
    if (error instanceof IdeArtifactError) throw new RemoteError(error.code, error.message, { detail: error.message })
    throw error
  }

  /** The readiness snapshot; manifest refusals ride their named RemoteError. */
  @Remote
  async status(signal: AbortSignal): Promise<IdeStatus> {
    void signal
    if (this.#startupError !== undefined) this.#refuse(this.#startupError)
    try {
      return await this.#controller.ensure()
    }
    catch (error) {
      this.#refuse(error)
    }
  }

  /** Live readiness: the current snapshot, then every change until aborted. */
  @Remote({ mode: 'stream' })
  events(signal: AbortSignal): AsyncIterable<IdeStatus> {
    const controller = this.#controller
    return {
      [Symbol.asyncIterator](): AsyncIterator<IdeStatus, undefined> {
        let wake: ((status: IdeStatus) => void) | undefined
        let parked: Promise<IdeStatus> | undefined
        let seen = false
        const fire = (status: IdeStatus): void => {
          if (wake === undefined) return
          const deliver = wake
          wake = undefined
          parked = undefined
          deliver(status)
        }
        const off = controller.subscribe(fire)
        signal.addEventListener('abort', () => {
          off()
          fire(controller.status)
        }, { once: true })
        return {
          async next(): Promise<IteratorResult<IdeStatus, undefined>> {
            if (!seen) {
              seen = true
              return { value: controller.status, done: false }
            }
            if (signal.aborted) return { value: undefined, done: true }
            parked ??= new Promise<IdeStatus>((resolve) => {
              wake = resolve
            })
            const status = await parked
            if (signal.aborted) return { value: undefined, done: true }
            return { value: status, done: false }
          },
          async return(): Promise<IteratorReturnResult<undefined>> {
            off()
            return { value: undefined, done: true }
          },
        }
      },
    }
  }

  /** Queue one open into the bridge downlink and nudge the spawn. */
  @Remote
  async open(path: string, signal: AbortSignal): Promise<void> {
    void signal
    this.#controller.open(path)
    try {
      await this.#controller.ensure()
    }
    catch (error) {
      this.#refuse(error)
    }
  }

  /** Drain one queued open; `undefined` empties the bridge's pump loop. */
  @Remote
  async openNext(signal: AbortSignal): Promise<string | undefined> {
    void signal
    return this.#controller.takeOpen()
  }

  /** One bridge event-uplink frame: save, active editor, diagnostics. */
  @Remote
  async report(kind: IdeReport['kind'], path: string | undefined, detail: string | undefined, signal: AbortSignal): Promise<void> {
    void signal
    this.#controller.report({ kind, path, detail })
  }

  /** The live event-uplink projection the outer chrome mirrors. */
  @Remote
  async reports(signal: AbortSignal): Promise<readonly IdeReport[]> {
    void signal
    return this.#controller.reports()
  }

  /** The bridge's hello: flips readiness when a child is live. */
  @Remote
  async hello(signal: AbortSignal): Promise<boolean> {
    void signal
    return this.#controller.hello()
  }
}

// Eager warm-up when booted as a class plugin: the Loader runs the `init`
// symbol after construction; a warm ensure makes the first `status` from the
// web client land on `spawning` or a twin-refusal instead of a cold read.
;(Ide.prototype as unknown as Record<typeof Service.init, (this: Ide) => void>)[Service.init] = function (this: Ide) {
  this.start()
}
