/**
 * Host half of the embedded VS Code REH editor frame: owns the manifest row
 * load, the twin artifact resolution, the loopback REH spawn with its
 * per-launch token, and the frame-lifecycle `ide` Remote namespace the web
 * client's `ui-vscode` tab kind and the seat's frame plugin share. Session
 * content (notes, stops, turn spans) intentionally rides the house
 * checkpoint wire; the twin consumes it through the same generated client
 * halves the web consumes, on its own connection carrier.
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
import { IdeArtifactError, type IdeReport, type IdeStatus, type IdeSubprocessLike, type IdeUnpackLike } from './types.ts'

export { childOf, IdeController } from './controller.ts'
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
    /** The unpacked tree names no REH entry the spawn can exec. */
    'ide/twin-layout': { readonly detail: string }
  }
}

/**
 * The `ide` Remote namespace: frame lifecycle only. `status` is the unary the
 * tab kind's `canOpen` rides on cold open, `events` keeps it live, `open`
 * enqueues into the seat downlink, and `hello` is what the seat's frame
 * plugin calls once its extension host is up and has scrubbed its env.
 */
export default class Ide extends TypertRemoteService {
  static provide = 'ide'

  /**
   * The traceable context proxy rebinds method receivers on the wire, which
   * forbids private-field access there; the namespace bodies therefore live
   * in constructor closures exposed as plain readonly members.
   */
  readonly startWire: () => void
  readonly statusWire: (signal: AbortSignal) => Promise<IdeStatus>
  readonly eventsWire: (signal: AbortSignal) => AsyncIterable<IdeStatus>
  readonly openWire: (path: string, signal: AbortSignal) => Promise<void>
  readonly openNextWire: (signal: AbortSignal) => Promise<string | null>
  readonly reportWire: (
    kind: IdeReport['kind'], path: string | null, detail: string | null,
  ) => Promise<void>
  readonly reportsWire: (signal: AbortSignal) => Promise<readonly IdeReport[]>
  readonly helloWire: (signal: AbortSignal) => Promise<boolean>

  constructor(ctx: Context) {
    super(ctx, 'ide')
    let startupError: IdeArtifactError | undefined
    const controller = new IdeController({
      loadRow: async () => parseManifest(await readFile(manifestPathOf(process.env, process.cwd()), 'utf8')),
      env: process.env,
      cacheDir: defaultCacheDir(process.env),
      // Lazy reads: sibling base-layer entries may still be activating when
      // this constructor runs; the controller consults them at ensure time.
      get subprocess() {
        return ctx.get('subprocess') as IdeSubprocessLike | undefined
      },
      get unpack() {
        return ctx.get('unpack') as IdeUnpackLike | undefined
      },
      gatewayUrl: () => {
        const webServer = ctx.get('webServer') as { readonly port: number } | undefined
        return webServer === undefined ? undefined : `http://127.0.0.1:${webServer.port}`
      },
      admit: token => ctx.get('connection')?.admitFrameToken(token),
    })
    const refuse = (error: unknown): never => {
      if (error instanceof IdeArtifactError) throw new RemoteError(error.code, error.message, { detail: error.message })
      throw error
    }
    this.startWire = () => {
      void controller.ensure().catch((error: unknown) => {
        if (error instanceof IdeArtifactError) startupError = error
      })
    }
    this.statusWire = async (signal) => {
      void signal
      if (startupError !== undefined) refuse(startupError)
      try {
        return await controller.ensure()
      }
      catch (error) {
        return refuse(error)
      }
    }
    this.eventsWire = (signal) => {
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
    this.openWire = async (path, signal) => {
      void signal
      controller.open(path)
      try {
        await controller.ensure()
      }
      catch (error) {
        refuse(error)
      }
    }
    this.openNextWire = (signal) => {
      void signal
      return Promise.resolve(controller.takeOpen())
    }
    this.reportWire = (kind, path, detail) => {
      controller.report({ kind, path, detail })
      return Promise.resolve()
    }
    this.reportsWire = (signal) => {
      void signal
      return Promise.resolve(controller.reports())
    }
    this.helloWire = (signal) => {
      void signal
      return Promise.resolve(controller.hello())
    }
  }

  /** Kick one ensure after construction; a startup refusal is re-raised by the verbs. */
  start(): void {
    this.startWire()
  }

  /** The readiness snapshot; manifest refusals ride their named RemoteError. */
  @Remote
  async status(signal: AbortSignal): Promise<IdeStatus> {
    return this.statusWire(signal)
  }

  /** Live readiness: the current snapshot, then every change until aborted. */
  @Remote({ mode: 'stream' })
  events(signal: AbortSignal): AsyncIterable<IdeStatus> {
    return this.eventsWire(signal)
  }

  /** Queue one open into the seat downlink and nudge the spawn. */
  @Remote
  open(path: string, signal: AbortSignal): Promise<void> {
    return this.openWire(path, signal)
  }

  /** Drain one queued open; `null` empties the seat's pump loop. */
  @Remote
  openNext(signal: AbortSignal): Promise<string | null> {
    return this.openNextWire(signal)
  }

  /** One seat event-uplink frame: save, active editor, diagnostics. */
  @Remote
  report(kind: IdeReport['kind'], path: string | null, detail: string | null, signal: AbortSignal): Promise<void> {
    void signal
    return this.reportWire(kind, path, detail)
  }

  /** The live event-uplink projection the outer chrome mirrors. */
  @Remote
  reports(signal: AbortSignal): Promise<readonly IdeReport[]> {
    return this.reportsWire(signal)
  }

  /** The seat's hello: flips readiness when a child is live. */
  @Remote
  hello(signal: AbortSignal): Promise<boolean> {
    return this.helloWire(signal)
  }
}

// Eager warm-up when booted as a class plugin: the Loader runs the `init`
// symbol after construction; a warm ensure makes the first `status` from the
// web client land on `spawning` or a twin-refusal instead of a cold read.
;(Ide.prototype as unknown as Record<typeof Service.init, (this: Ide) => void>)[Service.init] = function (this: Ide) {
  this.start()
}
