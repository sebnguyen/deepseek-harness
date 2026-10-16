/**
 * VS Code twin spawner and the `ideBridge` Remote namespace.
 *
 * The namespace serves two public consumers: the web UI's twin-state reads
 * (`status`) plus its file-forward calls (`open`, enqueued as downlink
 * frames), and the staged bridge extension inside the twin itself (`downlink`
 * for its private frame stream, `report` for the uplink). The twin
 * authenticates with its per-spawn token on the Connection bearer boundary;
 * the web UI presents the ordinary browser cookie. Downlink frame verbs are
 * `'<extensionId>/<verb>'`-namespaced so sibling twin planes can own their
 * prefixes without a runtime contract change.
 * @module @deepseek-ai/dsh-api-ide
 */

import { createServer } from 'node:net'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {
  IdeBridgeDownlinkFrame,
  IdeBridgeHelloMeta,
  IdeBridgeOpenRequest,
  IdeBridgeReportRequest,
  IdeBridgeStatus,
  IdeBridgeTwinCall,
} from './types.ts'
import { resolveTwinDist } from './twin-dist.ts'
import { pickStablePort } from './twin-port.ts'
import { stableTwinToken } from './twin-token.ts'
import { stageVscodeBridgeExtension, stageVscodeBridgeIdentity, stageTwinTheme } from './twin-theme.ts'

export type {
  IdeBridgeDownlinkFrame,
  IdeBridgeFaultDetails,
  IdeBridgeHelloMeta,
  IdeBridgeOpenRequest,
  IdeBridgeReportEvent,
  IdeBridgeReportRequest,
  IdeBridgeStatus,
  IdeBridgeTwinCall,
} from './types.ts'
export { findTwinDist, resolveTwinDist, twinDistCandidates } from './twin-dist.ts'
export { pickStablePort } from './twin-port.ts'
export { stableTwinToken } from './twin-token.ts'
export {
  DO_THEME_COLORS,
  DO_TOKEN_COLORS,
  stageVscodeBridgeIdentity,
  stageTwinTheme,
  TWIN_CONFIGURATION_DEFAULTS,
  VSCODE_THEME_DIR_NAME,
  VSCODE_THEME_EXTENSION_ID,
  VSCODE_THEME_EXTENSION_VERSION,
  twinThemeFile,
  twinThemeManifest,
} from './twin-theme.ts'
export type { VscodeBridgeIdentity } from './types.ts'

/** Plugin config, filled by the deployment row in the bundle's cordis.patch.yml. */
export interface Config {
  /**
   * Absolute path of the combined VS Code twin dist. Empty puts the namespace
   * on the single discovery pipeline: the machine-wide
   * `$DSH_HOME/cache/vscode-twin/dist` source-build cache that `pnpm run
   * vscode:twin` fills (see `twin-dist.ts`) — when no dist exists there,
   * `status` answers `enabled: false` and the client tab stays on the
   * fallback text editor.
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
  /** The spawn token: twin identity on the bearer boundary. */
  readonly tkn: string
}

/** Downlink queue backlog held for an unconnected seat (oldest frames drop past it). */
const DOWNLINK_QUEUE_CAP = 256

/**
 * One twin's bridge state: what it told us about itself, the frames headed
 * its way, and the one active downlink publisher. The seat is keyed by the
 * twin's spawn token, which is the bearer-token identity the connection
 * package checks — the twin knows nothing of sessions or workspace keys.
 */
interface SeatState {
  /** The connect-time `hello` metadata, or null until the seat reports in. */
  hello: IdeBridgeHelloMeta | null
  /** Bounded backlog awaiting publication; the publish cursor is `flushed`. */
  queue: IdeBridgeDownlinkFrame[]
  /** Frames already handed to a downlink publisher (the backlog start index). */
  flushed: number
  /**
   * The current publisher generation: bumped each time a new downlink
   * attaches, which supersedes a stale (reconnecting) loop trying to
   * publish on the same twin.
   */
  generation: number
  /** Consumer-resume hooks, woken by {@link Ide.queueFrame}. */
  readonly waiters: Set<() => void>
}

function emptySeat(): SeatState {
  return {
    hello: null,
    queue: [],
    flushed: 0,
    generation: 0,
    waiters: new Set(),
  }
}

/**
 * Spawner-wide state: ONE twin per workspace root (the session id stands in
 * when the header carries no cwd), owned by the host plugin lifetime. This is
 * what makes a session switch on the same workspace a no-op for the client —
 * the URL + token it polls back are identical, so the frame needn't navigate.
 */
interface IdeTwinManager {
  readonly dispose: () => void
  readonly ensure: (workspaceKey: string, sessionId: string) => Promise<IdeTwin>
  /** Resolve a live twin by its spawn token, or undefined for stale/dead tokens. */
  readonly twinOfToken: (token: string) => IdeTwin | undefined
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
function createTwinManager(
  ctx: Context,
  config: Config,
  onTokenDropped: (token: string) => void,
  dshOrigin: () => string,
): IdeTwinManager {
  const twins = new Map<string, Promise<IdeTwin>>()
  const tokenToWorkspace = new Map<string, string>()
  const twinByToken = new Map<string, IdeTwin>()
  // One stable-port band serves every dist on the machine, so two concurrent
  // spawns must not probe the band in parallel: both would see the same port
  // free, write the same pin, and whichever child bound second would fight
  // the loser until its tokens 403 against the survivor's origin checks.
  let spawnGate: Promise<unknown> = Promise.resolve()
  const forgetToken = (token: string): void => {
    const workspaceKey = tokenToWorkspace.get(token)
    if (workspaceKey === undefined) return
    tokenToWorkspace.delete(token)
    twinByToken.delete(token)
    onTokenDropped(token)
  }
  const enqueueTwinSpawn = (body: () => Promise<IdeTwin>): Promise<IdeTwin> => {
    const queued = spawnGate.then(() => body())
    spawnGate = queued.then(
      () => undefined,
      () => undefined,
    )
    return queued
  }
  return {
    dispose(): void {
      for (const pending of twins.values()) {
        void pending.then((twin) => { twin.handle.terminate() }, () => undefined)
      }
      twins.clear()
      tokenToWorkspace.clear()
      twinByToken.clear()
    },
    twinOfToken: token => twinByToken.get(token),
    ensure(workspaceKey: string, sessionId: string): Promise<IdeTwin> {
      const live = twins.get(workspaceKey)
      if (live !== undefined) return live
      const pending = enqueueTwinSpawn(async (): Promise<IdeTwin> => {
        // Twin-local state dirs keep user settings, server state and installed
        // marketplace extensions inside the twin dist rather than the user's
        // home: the dist stays the pinned, self-owned payload.
        const stateDir = join(config.dist, '.dsh')
        await mkdir(join(stateDir, 'server'), { recursive: true })
        await mkdir(join(stateDir, 'user'), { recursive: true })
        await mkdir(join(stateDir, 'exts'), { recursive: true })
        // A workspace-pinned token keeps the client-visible identity stable
        // across respawns: the tuple the spawner persists is workspaceKey →
        // token, so a crashed twin comes back with the credentials every
        // parked iframe already holds.
        const token = await stableTwinToken(stateDir, workspaceKey)
        // A stable port keeps the iframe origin stable, which is what makes
        // the browser-side IndexedDB user settings survive a harness restart.
        const port = await pickStablePort(stateDir, config.dist) ?? await freePort()
        console.debug('[ide] twin spawning', { workspaceKey, port, sessionId })
        // The DO identity ships as a staged extension: configurationDefaults
        // the workbench actually reads, plus the DO Harness Dark theme.
        await stageTwinTheme(join(stateDir, 'exts'))
        // The compiled connection bridge, when the client build produced it;
        // absent it the twin stays theme-only and `dsh/frame/*` never fires.
        await stageVscodeBridgeExtension(join(stateDir, 'exts'))
        // The bridge binds the files its extension reads before it dials: the
        // host origin, this spawn's token, and the twin key it belongs to.
        await stageVscodeBridgeIdentity(stateDir, {
          dshOrigin: dshOrigin(),
          token,
          workspaceKey,
          sessionId,
        })
        // The vscode roster registry serves the plane manifest over HTTP from
        // the host webServer when it is mounted; the seat fetches it at boot.
        // Nothing is staged per spawn — an empty roster means a bridge-only
        // twin, and a stale optional-service read here once killed the spawn.
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
          tokenToWorkspace.set(token, workspaceKey)
          twinByToken.set(token, twin)
          void handle.done.then((outcome) => {
            // The child fell over before or during readiness: drop the full
            // collected stderr into the rejection so the client detail line
            // carries substance instead of a bare "spawn failed".
            console.warn('[ide] twin exited; dropping twin entry', { workspaceKey, exitCode: outcome.exitCode })
            if (twins.get(workspaceKey) === pending) twins.delete(workspaceKey)
            forgetToken(token)
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
              // Readiness never arrived, so this pending twin must leave the
              // map exactly like the handle-done path does: code-server can
              // orphan its REH child past the abort window, the next ensure
              // binds a different port, and the forgotten entry then chains
              // freshly dead children into an endless unready-respawn loop.
              if (twins.get(workspaceKey) === pending) twins.delete(workspaceKey)
              forgetToken(token)
              console.warn('[ide] twin never became ready', { workspaceKey })
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

  private readonly seats = new Map<string, SeatState>()

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
    this.twins = createTwinManager(
      ctx,
      Object.assign({}, config, { dist: this.dist }),
      (token) => { this.seats.delete(token) },
      () => this.dshOrigin,
    )
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
    // The twin-token bearer branch: strictly scoped to the namespace's two
    // twin-facing endpoints; the browser-cookie path for every other endpoint
    // is byte-identical. Absent `connection` (non-web profiles) the bridge
    // simply has no absorb point, which matches the twin lane being web-only.
    ctx.inject(['connection'], (scope) => {
      const withdraw = scope.connection.registerBearerRule({
        // The twin token reaches its own bridge wire plus the read/write
        // remotes its planes consume: checkpoint slot timelines and blobs
        // (the twin Timeline view), and the lineNotes projection (note
        // inlay hints plus the add-note uplink). Every other endpoint keeps
        // browser-cookie-only admission.
        endpoints: [
          'ideBridge/downlink',
          'ideBridge/report',
          'checkpoint/slots',
          'checkpoint/blob',
          'lineNotes/state',
          'lineNotes/add',
        ],
        validate: token => this.twins.twinOfToken(token) !== undefined,
      })
      return () => { withdraw() }
    })
    ctx.inject(['webServer'], (scope) => {
      this.dshOrigin = `http://127.0.0.1:${scope.webServer.port}`
      return () => { this.dshOrigin = '' }
    })
  }

  /** Loopback origin of the host web server, when the web profile resolved it ('' otherwise). */
  private dshOrigin = ''

  /**
   * Pre-spawn the freshest session's twin; failures stay quiet because the
   * first `status()` call surfaces them (and re-tries the spawn) anyway.
   * @param sessions - the injected session registry.
   */
  private async warmLatest(sessions: Context['sessions']): Promise<void> {
    const [latest] = sessions.list()
    if (latest === undefined) return
    await this.twins.ensure(this.workspaceKey(latest.id, await this.workspaceRootOf(latest.id)), latest.id)
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
   * Queue one downlink file-open frame for the session's twin.
   *
   * Frames wait for the seat: an unconnected twin accumulates a bounded
   * backlog its next attach drains in order. A session whose twin cannot be
   * started surfaces the same detail its `status` would — `open` is
   * reachable only from a tab that already reports ready.
   * @param sessionId - the session whose twin takes the frame.
   * @param request - the file and optional reveal line.
   * @param signal - caller cancellation (spawn readiness races it).
   */
  @Remote
  async open(sessionId: string, request: IdeBridgeOpenRequest, signal: AbortSignal): Promise<void> {
    assertOpenRequest(request)
    const { tkn } = await this.ready(sessionId, signal)
    console.debug('[ide] open', { sessionId, path: request.path, line: request.line ?? null, t6: tkn.slice(-6) })
    this.queueFrame(tkn, { type: 'ideBridge/open', path: request.path, ...(request.line === undefined ? {} : { line: request.line }) })
  }

  /**
   * Announce the focused session to its workspace's twin.
   *
   * One twin serves every session of one workspace root, so the tab tells
   * the twin — over this remote, queued as `ideBridge/activate` — which
   * session its planes should scope session-bound remote calls to. The
   * tab fires this on adoption and each session switch.
   * @param sessionId - the session whose tab is focused.
   * @param signal - caller cancellation.
   */
  @Remote
  async activate(sessionId: string, signal: AbortSignal): Promise<void> {
    const { tkn } = await this.ready(sessionId, signal)
    console.debug('[ide] activate', { sessionId, t6: tkn.slice(-6) })
    this.queueFrame(tkn, { type: 'ideBridge/activate', sessionId })
  }

  /**
   * The twin's private frame stream: attach by spawn token and follow frames.
   *
   * Re-attaching (a reconnecting client) supersedes the stale publisher; a
   * modest backlog replays at attach. The token is validated again here —
   * the bearer gate admits by rule shape, but identity resolution happens
   * per call so a revoked twin is answered within one frame.
   * @param request - the twin's spawn token.
   * @param signal - stream lifetime (gate aborts on disconnect).
   * @returns the twin's private frame stream.
   */
  @Remote({ mode: 'stream' })
  async *downlink(request: IdeBridgeTwinCall, signal: AbortSignal): AsyncIterable<IdeBridgeDownlinkFrame> {
    const seat = this.seatOf(request.token)
    const generation = ++seat.generation
    const t6 = request.token.slice(-6)
    console.debug('[ide] downlink attached', { t6, generation, backlog: seat.queue.length - seat.flushed })
    while (!signal.aborted && seat.generation === generation) {
      while (seat.flushed < seat.queue.length) {
        // Mark delivery at emit time: a consumer that returns after receiving
        // frame N must leave `flushed == N`, not restart from N-1 at re-attach.
        const frame = seat.queue[seat.flushed] as IdeBridgeDownlinkFrame
        seat.flushed += 1
        yield frame
      }
      if (signal.aborted || seat.generation !== generation) {
        console.debug('[ide] downlink detached', { t6, generation, superseded: seat.generation !== generation })
        return
      }
      await this.frameWait(seat, signal)
    }
  }

  /**
   * The twin's uplink: the connect-time `hello` is the only accepted event.
   * Projection events (save, active editor, diagnostics) left with the
   * vscode-events plane; a non-hello verb is a protocol mismatch and fails
   * loudly rather than being logged and dropped.
   * @param request - the twin token plus the event.
   * @param signal - caller cancellation.
   */
  @Remote
  async report(request: IdeBridgeReportRequest, signal: AbortSignal): Promise<void> {
    void signal
    const seat = this.seatOf(request.token)
    if (request.event.type !== 'hello') {
      throw new RemoteError(
        'ide/report-invalid',
        `ide: report event '${String((request.event as { type?: unknown }).type)}' is not accepted`,
        { reason: 'unknown-verb' },
      )
    }
    const { event } = request
    seat.hello = { extensionId: event.extensionId, version: event.version, workspaceRoot: event.workspaceRoot }
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
    const twin = await this.twins.ensure(this.workspaceKey(sessionId, root), sessionId)
    // Freshly-spawned children need their readiness window; an existing twin
    // is already up and re-probing costs one cheap round trip at worst.
    await waitReady(twin.url, this.config.readinessTimeoutMs, this.config.readinessPollMs, signal)
    return { ready: true, url: twin.url, tkn: twin.tkn, workspaceRoot: root }
  }

  /**
   * Resolve a live seat by spawn token, creating its state on first sight.
   * An unknown token names a dead or revoked twin — a stable failure over a
   * parallel rejection channel, so the caller surfaces it as a Remote error.
   * @param token - the twin spawn token.
   * @returns the seat owning this twin's queue and projections.
   */
  private seatOf(token: string): SeatState {
    if (typeof token !== 'string' || token === '' || this.twins.twinOfToken(token) === undefined) {
      throw new RemoteError('ide/token-unknown', 'ide: token names no live twin', { reason: 'unknown-token' })
    }
    const existing = this.seats.get(token)
    if (existing !== undefined) return existing
    const created = emptySeat()
    this.seats.set(token, created)
    return created
  }

  /**
   * Append one frame to a seat's backlog and wake its publishers. Twin-dead
   * tokens drop nothing here — unknown tokens got their seat earlier only
   * when the twin lived, and this method silently no-ops for the dead so
   * `open` races exit cleanly.
   */
  private queueFrame(tkn: string, frame: IdeBridgeDownlinkFrame): void {
    const seat = this.seats.get(tkn) ?? (this.twins.twinOfToken(tkn) === undefined ? undefined : this.seatOf(tkn))
    if (seat === undefined) {
      console.warn('[ide] frame dropped: token names no live twin', { verb: frame.type })
      return
    }
    seat.queue.push(frame)
    if (seat.queue.length > DOWNLINK_QUEUE_CAP) {
      const excess = seat.queue.length - DOWNLINK_QUEUE_CAP
      console.warn('[ide] downlink backlog overflow; dropping oldest frames', { verb: frame.type, excess })
      seat.queue.splice(0, excess)
      seat.flushed = Math.max(0, seat.flushed - excess)
    }
    console.debug('[ide] frame queued', { verb: frame.type, backlog: seat.queue.length - seat.flushed })
    for (const wake of [...seat.waiters]) wake.call(undefined)
  }

  /** Sleep until any frame lands (or the stream's signal aborts). */
  private frameWait(seat: SeatState, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const wake = (): void => {
        seat.waiters.delete(wake)
        resolve()
      }
      seat.waiters.add(wake)
      signal.addEventListener('abort', wake, { once: true })
    })
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

/** Defensive arg shape check — the codec catches type errors, this guards semantic edge cases. */
function assertOpenRequest(request: IdeBridgeOpenRequest): void {
  if (typeof request !== 'object' || request === null || typeof request.path !== 'string' || request.path === '') {
    throw new RemoteError(
      'ide/open-invalid',
      'ide/open: request.path must be a non-empty string',
      { reason: 'path-missing' },
    )
  }
  if (request.line !== undefined && (!Number.isInteger(request.line) || request.line < 1)) {
    throw new RemoteError(
      'ide/open-invalid',
      'ide/open: request.line must be a positive integer',
      { reason: 'line-invalid' },
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
