/**
 * The frame's lifecycle owner: one loopback REH child per Host, per-launch
 * token, readiness flipped only by the bridge hello, and a pending-open queue
 * the bridge downlink drains. The spawn rides the house `ctx.subprocess`
 * seam (`@deepseek-ai/dsh-subprocess`): the controller is a plain consumer
 * owning argv, the env overlay, and the REH listening line parsed off the
 * managed stdout — protocol framing belongs to consumers by the seam's own
 * contract. A missing twin or a missing seam is the frame-absent posture,
 * never an error: `ui-vscode`'s `canOpen` reads the snapshot and the registry
 * falls back to the CodeMirror editor exactly as the tab ranking intends.
 */
import { randomBytes } from 'node:crypto'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { resolveTwin } from './manifest.ts'
import { unpackTwin } from './unpack.ts'
import {
  IdeArtifactError,
  type IdeChildLike,
  type IdeControllerDependencies,
  type IdeManifestRow,
  type IdeReport,
  type IdeStatus,
  type ResolvedTwin,
} from './types.ts'

const ABSENT: IdeStatus = { ready: false, twinSha: null, reason: null, frameUrl: null }

/** The event uplink keeps only its most recent records; older journal lives in the session stream. */
export const IDE_REPORT_CAP = 100

/** The readiness line the REH agent prints once its socket is bound. */
const LISTENING_PATTERN = /Extension host agent listening on (\d+)/u

/** Stdout tail retained once the child preamble overflows the cap. */
const STDOUT_TAIL_BYTES = 1_024
const STDOUT_CAP_BYTES = 8_192

/**
 * Project one managed house handle onto the liveness slice the controller
 * tracks: the parsing of the listening line lives here because the seam
 * hands protocol framing to its consumers.
 * @param handle - the spawned child exactly as `ctx.subprocess` returned it.
 * @returns exited/port/kill face over the managed range.
 */
export function childOf(handle: SubprocessHandle): IdeChildLike {
  const stream = handle.stdout
  const port = stream === undefined ? undefined : new Promise<number>((resolve, reject) => {
    let buffer = ''
    stream.on('data', (chunk: unknown) => {
      if (buffer.length > STDOUT_CAP_BYTES) buffer = buffer.slice(-STDOUT_TAIL_BYTES)
      buffer += String(chunk)
      const match = LISTENING_PATTERN.exec(buffer)
      if (match !== null) resolve(Number(match[1]))
    })
    void handle.done.then(() => {
      reject(new IdeArtifactError('ide/twin-layout', 'REH child exited before reporting a listening port'))
    }, reject)
  })
  return {
    exited: handle.done.then(outcome => outcome.exitCode),
    ...port === undefined ? {} : { port },
    kill: async () => {
      handle.terminate()
      await handle.waitForExit()
    },
  }
}

export class IdeController {
  #deps: IdeControllerDependencies
  #status: IdeStatus = ABSENT
  #child: { readonly token: string; readonly child: IdeChildLike } | undefined
  #revokeAdmit: (() => void) | undefined
  #observers = new Set<(status: IdeStatus) => void>()
  #pendingOpens: string[] = []
  #reports: IdeReport[] = []
  #twin: ResolvedTwin | undefined
  #row: IdeManifestRow | undefined

  constructor(deps: IdeControllerDependencies) {
    this.#deps = deps
  }

  /** The current readiness snapshot, identity-fresh per change. */
  get status(): IdeStatus {
    return this.#status
  }

  /** The validated manifest row the last ensure read, when one was read. */
  get row(): IdeManifestRow | undefined {
    return this.#row
  }

  /** The resolved twin the live or next child would ride. */
  get twin(): ResolvedTwin | undefined {
    return this.#twin
  }

  /** The launch token of the live child, when one is live. */
  get launchToken(): string | undefined {
    return this.#child?.token
  }

  /**
   * Observe readiness; the callback fires once immediately with the current
   * snapshot and on every change until the returned disposer runs.
   * @param observer - receives each fresh snapshot.
   * @returns the disposer.
   */
  subscribe(observer: (status: IdeStatus) => void): () => void {
    this.#observers.add(observer)
    observer(this.#status)
    return () => {
      this.#observers.delete(observer)
    }
  }

  #set(status: IdeStatus): void {
    this.#status = status
    for (const observer of this.#observers) observer(status)
  }

  /**
   * Ensure the frame child: read the row, resolve the twin, and degrade to the
   * named frame-absent posture when no twin or no subprocess seam is present.
   * Manifest and artifact failures rethrow their named errors so the `ide`
   * Remote namespace can refuse loud. Idempotent while a child is live.
   */
  async ensure(): Promise<IdeStatus> {
    if (this.#child !== undefined) return this.#status
    const row = await this.#deps.loadRow()
    this.#row = row
    const twin = await resolveTwin(row, this.#deps.env, this.#deps.cacheDir)
    this.#twin = twin
    if (twin === undefined || this.#deps.subprocess === undefined) {
      this.#set({ ready: false, twinSha: twin === undefined ? null : row.upstreamSha, reason: 'no-twin', frameUrl: null })
      return this.#status
    }
    const subprocess = this.#deps.subprocess
    const unpacked = await unpackTwin(twin, this.#deps.unpack)
    const token = randomBytes(24).toString('hex')
    this.#revokeAdmit?.()
    this.#revokeAdmit = this.#deps.admit?.(token)
    const gatewayUrl = this.#deps.gatewayUrl?.()
    const sessionId = this.#deps.env.DSH_SESSION_ID
    const child = childOf(subprocess.spawn({
      argv: [process.execPath, unpacked.serverEntry, '--port', '0', '--connection-token', token],
      cwd: unpacked.unpackDir,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 5_000,
      env: {
        DSH_IDE_TOKEN: token,
        ...gatewayUrl === undefined ? {} : { DSH_GATEWAY_URL: gatewayUrl },
        ...sessionId === undefined ? {} : { DSH_SESSION_ID: sessionId },
      },
    }))
    this.#child = { token, child }
    this.#set({ ready: false, twinSha: row.upstreamSha, reason: 'spawning', frameUrl: null })
    if (child.port !== undefined) {
      void child.port.then((port) => {
        /* v8 ignore next 2 -- a port can only resolve while its child is the live
           one; a replaced-but-still-reporting child is unreachable by construction. */
        if (this.#child?.child === child)
          this.#set({ ...this.#status, frameUrl: `http://127.0.0.1:${port}/?tkn=${token}` })
      }).catch(() => {})
    }
    void child.exited.finally(() => {
      this.#revokeAdmit?.()
      this.#revokeAdmit = undefined
      if (this.#child?.child === child) {
        this.#child = undefined
        this.#set({ ready: false, twinSha: null, reason: 'no-twin', frameUrl: null })
      }
    })
    return this.#status
  }

  /**
   * The bridge's hello over the gateway: the only thing that flips readiness.
   * A hello without a live child is refused and returns false.
   * @returns whether the hello landed on a live child.
   */
  hello(): boolean {
    if (this.#child === undefined) return false
    this.#set({ ...this.#status, ready: true, reason: null })
    return true
  }

  /**
   * Queue one `ide.open` request for the bridge downlink.
   * @param path - workspace path to open in the frame.
   */
  open(path: string): void {
    this.#pendingOpens.push(path)
  }

  /** Drain the pending open queue one entry; the bridge downlink's poll. */
  takeOpen(): string | null {
    return this.#pendingOpens.shift() ?? null
  }

  /**
   * Record one bridge event-uplink frame under the cap.
   * @param report - save, active-editor, or diagnostics observation.
   */
  report(report: IdeReport): void {
    this.#reports.push(report)
    if (this.#reports.length > IDE_REPORT_CAP) this.#reports.splice(0, this.#reports.length - IDE_REPORT_CAP)
  }

  /** The live event-uplink projection the outer chrome mirrors. */
  reports(): readonly IdeReport[] {
    return [...this.#reports]
  }

  /** Kill the child and settle into the disposed frame-absent posture. */
  async dispose(): Promise<void> {
    const live = this.#child
    this.#child = undefined
    this.#revokeAdmit?.()
    this.#revokeAdmit = undefined
    if (live !== undefined) await live.child.kill()
    this.#set({ ready: false, twinSha: null, reason: 'disposed', frameUrl: null })
  }
}
