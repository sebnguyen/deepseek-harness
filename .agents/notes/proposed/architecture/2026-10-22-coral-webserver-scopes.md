# Agent Note: One Coral webserver per instance with a URL scope per standard

Status: proposed

Cordis terms (`Plugin`, `Runtime`, `Fiber`, `Context`, `Impl`, `scope`, `inject`) are used per `/home/snguyen/dev/digitalocean/idk/AGENTS.md` §3 and §7; engine behavior cited as `file.ts:line` refers to `deepseek-harness-oceanic/vendor/cordis/src/`.

## Problem

Coral's inbound frontier has no owner. `base-carriers.md` v0.2 declares `ServerCarrier.bind(server: ServerLike)`, `reef.carrier.a2a-server` declares a different `cardUrl()/bind(HTTPServer)/handle(envelope)` triple, and `coral.webserver` is named as the "one dumb socket" in the carrier-plane overview but has no note, no package, and no contract. Three consequences follow: the `/api` trusted-client frontier and the peer `/a2a` frontier can share a listener with no declared trust boundary; two standards can claim the same path; and TLS or mTLS configuration has no owner. The old `ServerCarrier` note also defines the inbound face differently from the standard-plane proposal, so there is no single contract for a peer request to enter.

## Proposal

`coral.webserver` is a base Plugin at the bottom of the plane. It binds one listener per instance and mounts URL scopes into a route table. It knows routes, TLS, and compression; it knows no harness concepts.

```ts
export type UrlScope = `/${string}/`

export interface RouteHandler {
  handle(request: WebRequest): Promise<WebResponse>
}

export interface UpgradeHandler {
  handle(socket: Duplex, request: WebRequest): Promise<void>
}

export interface WebServer extends Disposable {
  origin(): string
  mount(scope: UrlScope, handler: RouteHandler): Disposable
  upgrade(scope: UrlScope, handler: UpgradeHandler): Disposable
  tls(): TlsPosture
}
```

### Scope map

| Scope | Owner | Contents | Trust fence |
|---|---|---|---|
| `/.well-known/` | each mounted standard | agent card; GET only, no session | public read; card signature verified by peers |
| `/a2a/` | `reef.carrier.a2a-server`, or the mounted standard | A2A JSON-RPC and SSE | mTLS, bearer, or card signature per `reef.trust` |
| `/api/` | the human-client frontier | the existing Typert and Connection world | loopback and browser fence |
| `/admin/` | `reef.carrier.api` | fleet admin JSON-RPC and SSE | localhost in memory mode; mTLS beyond |

Five rules keep the scopes separate. One listener serves an instance, and `origin()` is stable for the instance lifetime. Scopes are disjoint prefixes: a second mount under an already-mounted prefix rejects with `scope-already-mounted`, and there is no implicit nesting. Trust is scope-local: a handler for one scope cannot serve another scope's path, and a foreign protocol frame under `/api`, or a client endpoint under `/a2a`, is a review-visible rule break. `/admin/` exists only in the reef profile; the coral profile mounts `/.well-known/`, `/a2a/`, and `/api/`. Teardown unmounts scopes in reverse mount order and closes the listener only after every handler releases.

The standard-plane note ([the standard-plane note](2026-10-22-coral-standard-plane.md)) owns what each standard mounts; this note owns where those mounts land and which fence they inherit.

### Server face

`ServerCarrier` shrinks to the two verbs the base contract already implies:

```ts
export interface ServerCarrier extends Disposable {
  readonly standard: StandardId
  readonly flavor: FlavorId
  bind(server: WebServer): Disposable
  observe(): AsyncIterable<{ session: Address; envelope: Envelope }>
}
```

`cardUrl()` disappears as a verb. The card is a route the standard mounts under `/.well-known/`, and its path is configuration, not API. `handle(envelope)` disappears because the carrier contract already carries envelopes; an inbound request either becomes an envelope on `observe()` or is rejected at the scope fence. `ServerLike` is deleted; the server face binds `WebServer`, the one real type, rather than a structural stand-in.

### TLS posture

`tls()` reports one of three modes: `off` (loopback only), `server` (a server certificate), or `mutual` (client certificates required). The webserver owns certificate loading and reload. Each scope declares the minimum mode it accepts, and a request below its scope's minimum is refused before the handler runs. Deployment material — k8s sidecar secrets, container bearer snapshots — stays in the profile's manifest, not in the webserver.

## Alternatives considered

**One server per standard.** Each standard would own its port and TLS configuration. It loses on port sprawl, duplicated certificates, and the impossibility of one stable `origin()`; a peer also cannot discover which port a standard chose without a separate map.

**Reuse `dsh-host-webserver` directly.** That package is the harness's app server and carries app routes and harness concepts. Coral needs the same posture — one listener, a route table, TLS — without the app; inheriting its shape while owning a thinner package is cheaper than forking it.

**Let `reef.carrier.a2a-server` own the HTTP listener.** The coral profile includes the A2A server, but the profile also serves `/api` and the card; letting one standard own the socket makes the other scopes guests of that standard and leaves the webserver's invariants unenforceable.

**Use the existing mux mechanism.** Mux names logical-stream multiplexing (`streamId`) in DSH; these are URL prefixes. Reusing the noun would conflate two routing layers.

**Route by hostname instead of path.** Host-based routing requires DNS per standard and does not solve path-level trust; it also breaks the spec-mandated `/.well-known/agent-card.json` root.

## Acceptance criteria

- One listener serves an instance; `origin()` is identical for every caller and stable across mounts.
- Mounting an overlapping scope rejects with `scope-already-mounted`; a handler under `/a2a/` cannot receive a request whose path is under `/api/`.
- A request below a scope's TLS minimum is refused before the handler runs; the three modes are covered by tests.
- Teardown releases every mounted handler and closes the listener; a second dispose is a no-op.
- The webserver package imports no standard and no harness package.
- The coral profile mounts exactly `/.well-known/`, `/a2a/`, and `/api/`; the reef profile adds `/admin/`.

## Risks

- Path-prefix matching has edge cases (trailing slash, percent-encoding, case); the route table must canonicalize before matching.
- Certificate ownership is deployment-specific; k8s sidecars and container secrets may not agree on reload semantics.
- `/admin/` on the same listener weakens the one-fence story if a single TLS posture serves both; some profiles may need a separate loopback listener for admin.
- The webserver can grow into a framework; the contract must stay at `mount`, `upgrade`, and `tls`.
