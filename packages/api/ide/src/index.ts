/**
 * VS Code twin spawner and the `ideBridge` Remote namespace.
 *
 * Scope note: this is the scaffold row for the embedded-editor effort
 * (deepseek-harness `.agents/notes/proposed/architecture/2026-10-09-embedded-vscode-reh-editor-frame.md`).
 * It carries exactly one Remote method — `status` — because everything the
 * client needs to decide "mount the iframe or stay on the fallback" is one
 * ready/URL/token answer. Downlink events, the `vscode` namespace, and the
 * packaged bridge extension are later layers in the same note.
 * @module @deepseek-ai/dsh-api-ide
 */

import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type { IdeBridgeStatus } from './types.ts'
import { resolveTwinDist } from './twin-dist.ts'
import { pickStablePort } from './twin-port.ts'
import { stageTwinTheme } from './twin-theme.ts'

export type { IdeBridgeStatus } from './types.ts'
export { findTwinDist, resolveTwinDist, twinDistCandidates } from './twin-dist.ts'
export { pickStablePort } from './twin-port.ts'
export {
  DO_THEME_COLORS,
  DO_TOKEN_COLORS,
  stageTwinTheme,
  TWIN_CONFIGURATION_DEFAULTS,
  TWIN_THEME_DIR_NAME,
  TWIN_THEME_EXTENSION_ID,
  TWIN_THEME_EXTENSION_VERSION,
  twinThemeFile,
  twinThemeManifest,
} from './twin-theme.ts'

/** Plugin config, filled by the deployment row in the bundle's cordis.patch.yml. */
export interface Config {
  /**
   * Absolute path of the combined VS Code twin dist: the host's
   * `vscode-reh-web-<platform>-<arch>` lane product. Empty puts the namespace on
   * discovery: the fresh lane beside a sibling `vscode` checkout, then the
   * sibling, then the in-repo `.vscode-twin/dist`, then the machine-wide
   * `$DSH_HOME/cache/vscode-twin/dist` source-build cache that `pnpm run
   * vscode:twin` fills (see `twin-dist.ts`) — the candidates stand in, and
   * only when none exists does `status` answer `enabled: false` and the
   * client tab stay on the fallback text editor.
   */
  dist: string
  /** Milliseconds one `status` call waits for a spawn to answer HTTP before reporting not-ready. */
  readinessTimeoutMs: number
  /** Milliseconds between two readiness polls inside that window. */
  readinessPollMs: number
}

export const Config: z<Config> = z.object({
  dist: z.string().default(''),
  readinessTimeoutMs: z.number().step(1).min(1_000).default(45_000),
  readinessPollMs: z.number().step(1).min(100).default(500),
})

/** One live twin: the child, its transport, and the URL the iframe mounts. */
interface IdeTwin {
  readonly handle: SubprocessHandle
  readonly url: string
  readonly tkn: string
}

/**
 * Spawner-wide state: ONE twin per workspace root (the session id stands in
 * when the header carries no cwd), owned by the host plugin lifetime. This is
 * what makes a session switch on the same workspace a no-op for the client —
 * the URL + token it polls back are identical, so the frame needn't navigate.
 */
interface IdeTwinManager {
  readonly dispose: () => void
  readonly ensure: (workspaceKey: string) => Promise<IdeTwin>
}

/**
 * Ask the kernel for a free loopback port, in the standard listen-zero idiom.
 * A race exists between release and the REH binding it; the readiness poll is
 * what makes a (rare) collision visible rather than silent.
 * @returns an unoccupied loopback TCP port.
 */
async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => {
        if (address === null || typeof address !== 'object') {
          reject(new Error('ide: listen(0) answered without a port'))
          return
        }
        resolve(address.port)
      })
    })
  })
}

/**
 * Wait for the twin to answer on its loopback URL.
 * @param url - the loopback base URL to probe.
 * @param timeoutMs - total wait window.
 * @param pollMs - spacing between probes.
 * @param signal - host-supplied cancellation (session teardown or caller abort).
 */
async function waitReady(url: string, timeoutMs: number, pollMs: number, signal?: AbortSignal): Promise<void> {
  const started = Date.now()
  for (;;) {
    signal?.throwIfAborted()
    try {
      const probe = await fetch(url, signal === undefined ? undefined : { signal })
      // Any response — even an early error page — means the listener is up.
      if (probe.status > 0) return
    } catch (error: unknown) {
      if (signal?.aborted === true) throw error
    }
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`ide: twin did not answer on ${url} within ${timeoutMs}ms`)
    }
    // Polling is inherently sequential.
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
}

/**
 * Create the per-session spawn manager bound to one host context.
 *
 * Children are spawned through `ctx.subprocess`, which hands us scrubbed
 * environment semantics and managed-range teardown for free; the module map
 * additionally guarantees one child per workspace root and a whole-manager
 * dispose when the host context ends.
 * @param ctx - host plugin context carrying the subprocess service.
 * @param config - deployment config (`dist` plus tuning).
 * @returns the spawn manager.
 */
function createTwinManager(ctx: Context, config: Config): IdeTwinManager {
  const twins = new Map<string, Promise<IdeTwin>>()
  return {
    dispose(): void {
      for (const pending of twins.values()) {
        void pending.then((twin) => { twin.handle.terminate() }, () => undefined)
      }
      twins.clear()
    },
    ensure(workspaceKey: string): Promise<IdeTwin> {
      const live = twins.get(workspaceKey)
      if (live !== undefined) return live
      const pending = (async (): Promise<IdeTwin> => {
        const token = randomBytes(24).toString('base64url')
        // Twin-local state dirs keep user settings, server state and installed
        // marketplace extensions inside the twin dist rather than the user's
        // home: the dist stays the pinned, self-owned payload.
        const stateDir = join(config.dist, '.dsh')
        await mkdir(join(stateDir, 'server'), { recursive: true })
        await mkdir(join(stateDir, 'user'), { recursive: true })
        await mkdir(join(stateDir, 'exts'), { recursive: true })
        // A stable port keeps the iframe origin stable, which is what makes
        // the browser-side IndexedDB user settings survive a harness restart.
        const port = await pickStablePort(stateDir, config.dist) ?? await freePort()
        // The DO identity ships as a staged extension: configurationDefaults
        // the workbench actually reads, plus the DO Harness Dark theme.
        await stageTwinTheme(join(stateDir, 'exts'))
        return await new Promise<IdeTwin>((resolve, reject) => {
          const setup = new AbortController()
          const handle = ctx.subprocess.spawn({
            argv: [
              join(config.dist, 'bin', 'code-server-oss'),
              '--host', '127.0.0.1',
              '--port', String(port),
              '--connection-token', token,
              '--accept-server-license-terms',
              '--disable-workspace-trust',
              '--disable-telemetry',
              '--server-data-dir', join(stateDir, 'server'),
              '--user-data-dir', join(stateDir, 'user'),
              '--extensions-dir', join(stateDir, 'exts'),
            ],
            cwd: config.dist,
            stdio: {
              stdin: 'ignore',
              stdout: { maxBytes: 64 * 1024 },
              stderr: { maxBytes: 64 * 1024 },
            },
            graceMs: 5_000,
            signal: setup.signal,
          })
          const twin: IdeTwin = {
            handle,
            url: `http://127.0.0.1:${port}`,
            tkn: token,
          }
          void handle.done.then((outcome) => {
            // The child fell over before or during readiness: drop the full
            // collected stderr into the rejection so the client detail line
            // carries substance instead of a bare "spawn failed".
            if (twins.get(workspaceKey) === pending) twins.delete(workspaceKey)
            setup.abort()
            const stderr = handle.collected.stderr?.readFrom(0).text.trim() ?? ''
            reject(new Error(
              `ide: twin exited during startup with code ${String(outcome.exitCode)}: ${stderr.slice(-400)}`,
            ))
          })
          void waitReady(twin.url, config.readinessTimeoutMs, config.readinessPollMs, setup.signal)
            .then(() => { resolve(twin) })
            .catch((error: unknown) => {
              handle.terminate()
              reject(error instanceof Error ? error : new Error(String(error)))
            })
        })
      })()
      twins.set(workspaceKey, pending)
      void pending.catch(() => {
        if (twins.get(workspaceKey) === pending) twins.delete(workspaceKey)
      })
      return pending
    },
  }
}

/** Host Remote namespace serving the client tab's VS Code state reads. */
export class Ide extends TypertRemoteService {
  static inject = ['subprocess', 'sessions', 'typert', 'sandboxPolicy']

  static Config: z<Config> = Config

  private readonly twins: IdeTwinManager

  /** The resolved twin dist: the config value, else the discovery winner, else ''. */
  private readonly dist: string

  /** Injected session/provider scope, bound during construction for the service lifetime. */
  private scope: { readonly sessions: Context['sessions']; readonly sandboxPolicy: Context['sandboxPolicy'] } | undefined

  /**
   * @param ctx - host plugin context.
   * @param config - deployment config from the bundle row.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'ideBridge')
    this.dist = resolveTwinDist(config.dist)
    this.twins = createTwinManager(ctx, { ...config, dist: this.dist })
    ctx.effect(() => () => { this.twins.dispose() })
    ctx.inject(['sessions', 'sandboxPolicy'], (scope) => {
      this.scope = scope
      // Eager part of the lazy/eager split: per-session twins stay lazy, but
      // the most recent session's REH spawns at boot so reopening it lands
      // ready instead of showing the boot hero for the spawn window.
      if (this.dist !== '') {
        void this.warmLatest(scope.sessions).catch(() => undefined)
      }
      return () => { this.scope = undefined }
    })
  }

  /**
   * Pre-spawn the freshest session's twin; failures stay quiet because the
   * first `status()` call surfaces them (and re-tries the spawn) anyway.
   * @param sessions - the injected session registry.
   */
  private async warmLatest(sessions: Context['sessions']): Promise<void> {
    const [latest] = sessions.list()
    if (latest === undefined) return
    await this.twins.ensure(this.workspaceKey(latest.id, await this.workspaceRootOf(latest.id)))
  }

  /**
   * Answer the twin state for one session, lazily spawning its REH.
   *
   * This is a plain `invoke`, not a stream: the client polls it on a short
   * interval until `ready`, matching the "fallback until hello" posture from
   * the design note without a push channel it would have to rebuild.
   * @param sessionId - the session whose twin to report.
   * @param signal - caller cancellation.
   * @returns the twin state; never throws for disabled or failed twins.
   */
  @Remote
  async status(sessionId: string, signal: AbortSignal): Promise<IdeBridgeStatus> {
    const idle = { url: null, tkn: null, workspaceRoot: null }
    if (this.dist === '') return { ...idle, enabled: false, ready: false, detail: 'no twin dist configured or discovered' }
    try {
      return { enabled: true, ...(await this.ready(sessionId, signal)), detail: null }
    } catch (error: unknown) {
      return {
        ...idle,
        enabled: true,
        ready: false,
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Spawn-and-wait for one session's twin, resolving its workspace root from
   * the session header with the sandbox root as the static fallback.
   * @param sessionId - session identity, already beyond the gateway boundary.
   * @param signal - caller cancellation.
   * @returns the ready triple the client needs to mount the iframe.
   */
  private async ready(sessionId: string, signal: AbortSignal): Promise<WireReady> {
    // The root must resolve before ensure: it IS the twin's key, so a session
    // switch onto the same workspace lands on the same URL + token pair and
    // the frame it feeds needs no reload at all.
    const root = await this.workspaceRootOf(sessionId)
    const twin = await this.twins.ensure(this.workspaceKey(sessionId, root))
    // Freshly-spawned children need their readiness window; an existing twin
    // is already up and re-probing costs one cheap round trip at worst.
    await waitReady(twin.url, this.config.readinessTimeoutMs, this.config.readinessPollMs, signal)
    return { ready: true, url: twin.url, tkn: twin.tkn, workspaceRoot: root }
  }

  /**
   * Resolve the session's workspace root.
   * @param sessionId - session identity.
   * @returns the header cwd, or the sandbox root when the header names none;
   *   `null` keeps the boundary JSON-safe while the client states it cannot mount.
   */
  /**
   * The twin-map key: the workspace root exactly, the session id when the
   * header names no cwd — unscoped sessions keep the old per-session hosts.
   */
  private workspaceKey(sessionId: string, root: string | null): string {
    return root ?? sessionId
  }

  private async workspaceRootOf(sessionId: string): Promise<string | null> {
    const scope = this.scope
    if (scope === undefined) return null
    return Promise.resolve(
      scope.sessions.get(sessionId as never)?.header?.cwd ?? (scope.sandboxPolicy.workspaceRoot as string | null) ?? null,
    )
  }
}

/** The ready-shaped slice {@link Ide.ready} produces before `enabled` is folded in. */
interface WireReady {
  readonly ready: true
  readonly url: string
  readonly tkn: string
  readonly workspaceRoot: string | null
}

/** Class plugin consumed by the Loader as the roster row's default export. */
export default Ide

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `ideBridge` Remote namespace. */
    ideBridge: Ide
  }
}
