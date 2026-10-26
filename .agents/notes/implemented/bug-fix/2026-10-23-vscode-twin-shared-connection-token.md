# Agent Note: One REH connection token per host — the twin cookie is port-blind

Status: implemented

## Problem

Every workspace twin was spawned with its own random `--connection-token`. The
REH writes that secret to `vscode-tkn` as a cookie with no port dimension, and
browsers scope cookies by host, not port. With two workspaces open, both twins
live under `127.0.0.1` on different ports, so whichever page loaded last
overwrote the shared cookie. The other twin then answered `403 Forbidden.` to
every cookie-only request — most visibly each webview's
`/oss-<commit>/static/out/vs/workbench/contrib/webview/browser/pre/index.html`,
the document every markdown and mermaid preview iframe loads, and any other
cookie-only product asset (a new panel's lazy chunk, the terminal's deferred
resources). Switching session tabs across workspaces was the trigger because
that is when the sibling twin boots and loads its page.

Reproduced with two real twins from the cached dist (ports 47011/47012,
tokens A/B): after `GET :47012/?tkn=B` set the cookie,
`GET :47011/` and `GET :47011/oss-<commit>/static/.../pre/index.html` both
returned 403, while the same requests returned 200 before B loaded. Also
reproduced against the live host's twin pair (46304/46306).

## Decision

Split the two identities that were sharing one token:

- **REH connection token (one per host process).** `Ide` mints it once in the
  constructor and passes it to every spawn's `--connection-token`. Every twin's
  page load now writes the identical `vscode-tkn` value, so no port can clobber
  a sibling's cookie. It rotates with the host process, so a twin orphaned by a
  dead host still answers 403.
- **Bridge seat token (one per spawn).** The private `ideBridge` bearer
  identity. Minted per spawn, staged into the twin's `bridge.json` for the
  bridge extension, and kept out of `IdeBridgeStatus` and every iframe URL.

`createTwinManager` takes the shared connection token; `IdeTwin` carries both
`tkn` (connection) and `seatToken` (bridge). `WireReady` returns both; `status`
strips the seat token, while `open` and `activate` queue frames by it.

## Alternatives considered

- **Per-workspace stable connection token (`stableTwinToken`).** Still two
  different values in one cookie jar, so the clobber remains.
- **One loopback IP per twin (127.0.0.2, …).** Gives each twin its own cookie
  jar, but `127.0.0.2` is not configured by default on macOS. Portability cost
  for a host-side problem.
- **Patch the webview bootstrap/URLs to carry `tkn`, or mint port-scoped cookie
  names.** Correct but needs a twin rebuild plus a CSP-hash edit, and the
  host-side split fixes every cookie-only path (previews, terminal assets,
  lazy product chunks) without touching the product.

## Consequences

- Twins share the connection secret: one twin's browser session can reach a
  sibling's loopback port. The boundary is unchanged in practice — same user,
  same browser, same host, and a drive-by web origin still lacks the cookie.
- A respawn within one host keeps both the pinned port and the connection
  token, so a parked frame from that workspace can reconnect to the new server
  instead of being permanently stale.
- The browser no longer receives the bridge seat token; tests read it from the
  staged `bridge.json`.
- The legacy `twin-token.*` pin stays exported and unread; no migration needed.

## Deferred

- Two *independent* harness hosts running at once each mint their own
  connection token, and their twins still share one `127.0.0.1` cookie jar.
  The reported setup is one host owning every twin; if concurrent hosts become
  a supported pattern, persist one token under `$DSH_HOME` so every host reads
  the same secret (the seat token already keeps orphan seats apart, so the
  orphan-rejection argument for rotation would no longer apply).

## Testing

- `packages/api/ide/tests/bridge.host.spec.ts`: seat tests now read the staged
  `bridge.json`; a new spec asserts two workspace twins report the same
  `status.tkn` and `--connection-token` while their seat tokens differ.
- Manual repro: two real REH instances with one shared `--connection-token`;
  after loading either twin's `/?tkn=...` page, both ports answer 200 to the
  cookie-only webview document regardless of which twin loaded last.
