/**
 * The frame's lifecycle owner: one loopback REH child per Host, per-launch
 * token, readiness flipped only by the bridge hello, and a pending-open queue
 * the bridge downlink drains. A missing twin is the frame-absent posture,
 * never an error: `ui-vscode`'s `canOpen` reads the snapshot and the registry
 * falls back to the CodeMirror editor exactly as the tab ranking intends.
 */
import { randomBytes } from 'node:crypto'
import { resolveTwin } from './manifest.ts'
import { unpackTwin } from './unpack.ts'
import type { IdeChildLike, IdeControllerDependencies, IdeManifestRow, IdeReport, IdeStatus, ResolvedTwin } from './types.ts'

const ABSENT: IdeStatus = { ready: false, twinSha: null, reason: null, frameUrl: null }

/** The event uplink keeps only its most recent records; older journal lives in the session stream. */
export const IDE_REPORT_CAP = 100

export class IdeController {
  #deps: IdeControllerDependencies
  #status: IdeStatus = ABSENT
  #child: { readonly token: string; readonly child: IdeChildLike } | undefined
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
    const env: Record<string, string> = { DSH_IDE_TOKEN: token }
    for (const [key, value] of Object.entries(this.#deps.env)) {
      if (value !== undefined) env[key] = value
    }
    const child = subprocess.spawn({
      command: process.execPath,
      args: [unpacked.serverEntry, '--port', '0', '--connection-token', token],
      env,
    })
    this.#child = { token, child }
    this.#set({ ready: false, twinSha: row.upstreamSha, reason: 'spawning', frameUrl: null })
    if (child.port !== undefined) {
      void child.port.then((port) => {
        if (this.#child?.child === child)
          this.#set({ ...this.#status, frameUrl: `http://127.0.0.1:${port}/?tkn=${token}` })
      })
    }
    void child.exited.finally(() => {
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
    if (live !== undefined) await live.child.kill()
    this.#set({ ready: false, twinSha: null, reason: 'disposed', frameUrl: null })
  }
}
