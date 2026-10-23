/**
 * Shared wire shapes for the `ideBridge` Remote namespace.
 *
 * The status object deliberately survives every failure mode on the wire:
 * a disabled twin, a spawn crash, or a readiness timeout all arrive as
 * `ready: false` with a human line rather than as a thrown Remote error, so
 * the client tab renders state instead of error transport.
 * @module @deepseek-ai/dsh-api-ide/types
 */

/** One session's VS Code twin state as the client tab renders it. */
export interface IdeBridgeStatus {
  /** True when a twin dist is configured at all; false renders the unavailable line. */
  readonly enabled: boolean
  /** True once the REH answers HTTP on its loopback port; the iframe mounts. */
  readonly ready: boolean
  /** Loopback base URL of the session's REH, e.g. "http://127.0.0.1:3481". */
  readonly url: string | null
  /**
   * The REH connection token this host armed the twin with; goes into the
   * `tkn` query and the host-scoped `vscode-tkn` cookie. Every twin of one
   * host shares this value, because a cookie is scoped by host, not by port.
   */
  readonly tkn: string | null
  /** Absolute workspace root for the session, for the `folder` query. */
  readonly workspaceRoot: string | null
  /** Human line for the not-ready or failed state. */
  readonly detail: string | null
}

// ---------------------------------------------------------------------------
// The twin bridge wire: downlink frames host → twin, uplink events twin → host.
// ---------------------------------------------------------------------------

/** Web UI → this twin: open one workspace file, optionally revealed at a line. */
export interface IdeBridgeOpenRequest {
  /** Absolute path or workspace-relative path understood by the twin's opened folder. */
  readonly path: string
  /** Optional 1-based line to reveal the file at. */
  readonly line?: number
}

/**
 * One downlink frame the Host enqueues for a session's twin and the staged
 * bridge extension receives over `ideBridge.downlink`. Verbs are
 * `'<extensionId>/<verb>'`-namespaced: `ideBridge/*` belongs to the Host's
 * own `open` route; sibling twin planes own their prefixes.
 */
export type IdeBridgeDownlinkFrame =
  | { readonly type: 'ideBridge/open'; readonly path: string; readonly line?: number }
  /**
   * Tab focus tells the shared twin which session now speaks: one twin serves
   * every session of one workspace root, so the planes that reach
   * `remote.<ns>` remotes carrying a `sessionId` parameter (checkpoint
   * slots/blobs, line notes) read their identity from this frame. The latest
   * activate wins; a seat attaching late replays the queued backlog in order.
   */
  | { readonly type: 'ideBridge/activate'; readonly sessionId: string }

/** Seat identity the bridge extension fires once per connection. */
export interface IdeBridgeHelloMeta {
  readonly extensionId: string
  readonly version: string
  readonly workspaceRoot: string | null
}

/**
 * Uplink union the bridge extension sends through `ideBridge.report`. Only
 * the connect-time `hello` remains: the projection events (save, activeEditor,
 * diagnostics) left with the vscode-events plane, whose collected read-model
 * had no consumer.
 */
export type IdeBridgeReportEvent =
  | ({ readonly type: 'hello' } & IdeBridgeHelloMeta)

/** Input of `ideBridge.downlink` / `ideBridge.report`: the twin identifies by its bridge seat token. */
export interface IdeBridgeTwinCall {
  /**
   * The per-twin bridge seat token staged in `bridge.json`; authenticated on
   * the bearer boundary. Distinct from the REH connection token.
   */
  readonly token: string
}

/** `ideBridge.report` request shape. */
export interface IdeBridgeReportRequest extends IdeBridgeTwinCall {
  readonly event: IdeBridgeReportEvent
}

/**
 * Everything the staged bridge extension needs to reach this host: its
 * loopback origin, the twin's spawn token, and the twin key the spawner
 * booked. Written per spawn beside the twin's state dirs (not inside
 * `exts/`, which only carries scanned extension payloads). Mirrored by
 * the twin's client side in `packages/extensions/vscode-cordis`.
 */
export interface VscodeBridgeIdentity {
  /** Loopback origin of the hosting dsh web server ('' while webServer is unknown). */
  readonly dshOrigin: string
  /**
   * The twin's private bridge seat token, presented as its bearer credential
   * and as the `tkn` query on its mux WebSocket. Minted per spawn so an
   * orphan cannot claim the seat, and never part of an iframe URL: the REH
   * connection token is a separate host-wide secret (see
   * {@link IdeBridgeStatus.tkn}).
   */
  readonly token: string
  /** The spawner's key for this twin (workspace root, else session id). */
  readonly workspaceKey: string
  /**
   * The session that spawned this twin, staged as the seat's bootstrap seed.
   * One twin serves every session of its workspace root, so the frame-time
   * `ideBridge/activate` supersedes this value on every tab focus; the seed
   * exists only so a twin works before the first activate frame lands.
   */
  readonly sessionId?: string
}

/** Wire details carried by every `ide/*` Remote failure. */
export interface IdeBridgeFaultDetails {
  /** The twin-facing fact that failed (kept coarse: identities already bounded by the token). */
  readonly reason: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The presented twin token names no live twin. */
    'ide/token-unknown': IdeBridgeFaultDetails
    /** `ide/report` carried a non-hello uplink event the host no longer accepts. */
    'ide/report-invalid': IdeBridgeFaultDetails
    /** `ide/open` rejected its payload's shape beyond codec typing. */
    'ide/open-invalid': IdeBridgeFaultDetails
  }
}
