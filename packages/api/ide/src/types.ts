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
  /** The connection token this spawn was armed with; goes into the `tkn` query. */
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

/** Seat identity the bridge extension fires once per connection. */
export interface IdeBridgeHelloMeta {
  readonly extensionId: string
  readonly version: string
  readonly workspaceRoot: string | null
}

/** Uplink event union the bridge extension sends through `ideBridge.report`. */
export type IdeBridgeReportEvent =
  | ({ readonly type: 'hello' } & IdeBridgeHelloMeta)
  | { readonly type: 'save'; readonly path: string }
  | { readonly type: 'activeEditor'; readonly path: string | null }
  | { readonly type: 'diagnostics'; readonly path: string; readonly errors: number; readonly warnings: number }

/** Input of `ideBridge.downlink` / `ideBridge.report`: the twin identifies by its spawn token. */
export interface IdeBridgeTwinCall {
  /** The per-twin spawn token (from the staged `bridge.json`); authenticated on the bearer boundary. */
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
  /** Per-twin spawn token the bridge presents as its bearer credential. */
  readonly token: string
  /** The spawner's key for this twin (workspace root, else session id). */
  readonly workspaceKey: string
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
    /** An uplink event arrived before the seat's connect-time `hello`. */
    'ide/seat-not-helloed': IdeBridgeFaultDetails
    /** `ide/open` rejected its payload's shape beyond codec typing. */
    'ide/open-invalid': IdeBridgeFaultDetails
  }
}
