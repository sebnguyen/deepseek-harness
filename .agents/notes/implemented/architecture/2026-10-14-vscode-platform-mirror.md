# Agent Note: vscode platform mirror — the twin's manifest, registry, and plane machinery as shipped

Status: implemented

## Problem

The web UI and the vscode twin ride the same two-engine stack — host Cordis engine + wire namespaces + client Cordis engine — but only the web had a machinery floor under it: a bundle-layer YAML roster, a host-half scanner that composes `window.__DSH_BOOT__` and combo scripts, per-package one-line `clientBundle()` configs, and an `api/remotes` catalog mounting every declared namespace in one pass. The twin owned exactly one staged artifact — the bridge's `extension.cjs` written per spawn, one scoped bearer-route pair — no roster, no manifest, and no mechanism for a plane package (event projections, timeline, line notes, checkpoint surface) to declare itself shippable onto its seat.

## Decision

The twin's machinery now mirrors the web's, reusing everything that survived verbatim.

**The vscode face tooling.** `packages/extensions/tsdown.vscode.ts` exports `vscodeBundle(pkgId, extraEntries)` — the vscode mirror of `clientBundle()` — emitting one self-contained CJS at `lib/vscode.js` per plane (`neverBundle: ['vscode']`, everything else inlined). A third aggregate, `tsconfig.vscode.json`, owns the vscode packages and selects their specs by suffix (`*.vscode.spec.*`, excluded from the host and default-lane inventories); `pnpm run build:lib:vscode` runs it plus the face bundling, `pnpm run test:vscode` runs the lane, and `pnpm run dev:vscode` (`scripts/dev-vscode.ts`) walks the two watch lanes like `dev-web`.

**Plane packages.** A plane is a package whose `dsh.vscode` block declares `"inject": [...], "platform": "vscode"`, whose vscode face is `src/vscode/index.ts` exporting `apply(ctx)` (plus optional `inject`), and whose host face is a documented inert apply — the roster row imports the package root on the host engine, and the vendored Loader accepts it there while the registry reads its `dsh.vscode` off the same `package.json`. The three pilots are `vscode-events` (uplink projections: save/activeEditor/diagnostics reported over `ideBridge.report`), `vscode-timeline` (checkpoint-timeline virtual documents), and `vscode-line-notes` (line-note rendering + focus uplink) at `packages/extensions/vscode-{events,timeline,line-notes}`.

**The composition registry.** `@deepseek-ai/dsh-vscode-modules` (`packages/extensions/vscode-modules`) is the host.Service analog of `dsh-client-modules`: it scans the host loader's entries, gates each on `dsh.vscode.platform === 'vscode'` (a dsh.vscode-specific parser — a plane is never silently absorbed through `dsh.client`), reads each plane's staged `lib/vscode.js` bytes, and composes the manifest graph: per-plane sha1-prefix `rev` plus a `v1:` row-set covering `rev`. A removed plane logs loudly; a declared-but-unbuilt plane drops with a warning, never the whole seat. Serving is HTTP: the registry registers `GET /vscode/manifest` and `GET /vscode/plugin/<id>` prefix routes on the host webServer (same unauthenticated static-asset posture as `/plugins`) and answers plane bytes from the same in-memory records the manifest names.

**The seat milestone.** `spawnBridgeSeat` in `packages/extensions/vscode-cordis/src/extension.ts` carries its reserved row 4: the vendored cordis `Loader`. The seat seeds `ctx.twinCore` with the bridge token, mounts the Loader, fetches `${dshOrigin}/vscode/manifest` once at boot, sets `loader.internal = vscodeModulesResolver(identity, graph)`, and creates one entry per row — a host without the registry serves no manifest and the seat stays bridge-only; one failing row logs and never strands siblings. Planes never `import vscode`: `vscode-cordis`'s `vscodeApi` facade (workspace + window + languages channels) is the only ambient surface they touch. The seat also `$mount`s the `timeline` and `lineNotes` remote descriptors beside `ideBridge`, so the `remote.*` service keys a plane's inject row names exist before any plane fiber starts.

**The namespaces.** `packages/api/timeline` (`timeline.history`, `timeline.slice` over a host-publisher row registry) and `packages/api/line-notes` (`lineNotes.state`, the `lineNotes.focus` uplink re-emitted as the host-local `lineNotes/focus` event) stand up the `TypertRemoteService` halves the planes' inject rows name, mounted by the `api/remotes` catalog on the web engine. Their registries are honest and currently empty: publishers (the checkpoint projection owner, the conversation's note feed) are the wiring seam this note leaves open, not a fake-data claim.

**Roster.** `packages/bundle/web-app/cordis.patch.yml` carries `vscode-modules`, the three planes, and the two namespace services; every web deployment now carries the twin roster with the web one. Deployments that never spawn a twin pay nothing — the scan is inert without a `dsh.vscode` package on the loader.

## Alternatives considered

- **`dsh.twin` for the face key (prior sketch)** — renamed to `dsh.vscode`: the runtime is vscode; "twin" is an architectural noun, wrong on a package key a dual runtime sits under.
- **One monolithic bridge extension containing every plane** — rejected: it freezes the roster inside `extension.cjs`, and every plane commit would force every bridge rebuild and respawn.
- **One vscode extension per plane** — rejected: vscode's extension scan happens once per extension-host boot; a new plane would cost an ext-host restart, throwing away the seat's live composition.
- **Seat-side manifest authorship (the REH writes its own manifest)** — rejected: the host writes bridge.json and composes the manifest; the seat only reads. Manifest ownership never sits with the party that runs untrusted-adjacent plane code.
- **Per-spawn file staging (`vscode-manifest.json` + `exts/` beside `bridge.json`)** — the draft's first design, superseded before shipping: the seat and registry already share one host process's webServer, so live HTTP serving removes the staging half entirely (no spawn-time byte copying, no staleness invariant to defend, and the manifest became a single source of truth at boot time rather than a per-spawn snapshot). The acceptance rows written for the file variant are kept as the registry's composition/determinism contract instead.

## Consequences

**Bought:** planes land without touching the bridge extension — one `dsh.vscode` plus one roster row is the whole contract; the seat's bridge stays protocol-thin; namespace contracts (`timeline`, `lineNotes`) exist on both engines per engine-face build; removal of a plane is a roster edit (the scan drops it loudly at the next flush). **Costs:** new-plane visibility is per-twin-boot (the seat fetches its manifest once; a respawn picks up new revs — the hot-rewire downlink listener the dev loop anticipates is not yet built); the manifest and plane routes are unauthenticated host-local prefix routes exactly like the web's `/plugins` (posture recorded, and every registry answer is content the same machine composes); `packages/api/timeline` and `packages/api/line-notes` expose real namespaces with no publishers yet — the projection-owner wiring is the recorded open seam. A historical readability note: this note's proposal-era drafts (Layers 1–8 in git history) contained a mid-draft flip from file staging to HTTP serving plus unpolished passages; the shipped form above is the authority, and the superseded draft survived only in `git`.

## Testing

The vscode lane (`pnpm run test:vscode`) carries the surface: registry roster scan, manifest schema/determinism and parsing gates, resolver URL resolution against a named manifest, seat-boot plane composition (rows apply once; a failing plane drops sibling-safe; empty manifest = bridge-only), events-plane projections, ambient vscode stubs. `packages/api/timeline` + `packages/api/line-notes` carry their own host specs. Aggregates: host, client, and vscode `tsc -b` clean; `pnpm run build:lib:vscode` and the host tsdown pass run over all packages.

## Related

- [Runtime faces and seat composition](2026-10-14-runtime-faces-and-seat-composition.md) — the engine-vocabulary map this machinery fits.
- [the vscode-twin extension cordis seat](../../proposed/architecture/2026-10-13-vscode-twin-extension-cordis-seat.md) — the bridge/seat contract this note grows row 4 from.
