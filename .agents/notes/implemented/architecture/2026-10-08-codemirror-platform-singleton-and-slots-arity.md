# Agent Note: CodeMirror state as a platform singleton, and full-arity remote calls

Status: implemented

## Problem

Two independent web-client failures traced to the plugin-bundle architecture landed together with the line-anchored notes work. First, switching a file tab to the source editor blanked the page: `ui-editor` creates the CodeMirror view from its own bundled `@codemirror/state`, while the `ui-line-note` plugin appends a gutter extension built from its own bundled copy; CodeMirror validates extension identity with `instanceof` against the view's state package, so the second copy throws `Unrecognized extension value in extension set` inside view creation and the slot owner crashed. Second, every client read of the checkpoint register rejected with `checkpoint/slots expected 2 argument(s), got 1`: the typert client proxy requires one argument per declared parameter of `@Remote('slots') async slots(session, path?)`, and all five call sites passed only the session id, so the register never loaded and the Timeline/notes surfaces stayed empty.

## Decision

CodeMirror's two identity-carrying packages join the platform module table (`packages/client/web/src/platform.ts`), exactly the mechanism react already uses: the shell statically imports them in `seed.ts`, every plugin bundle externalizes the specifiers through the shared tsdown client preset, and the browser loader resolves them to the one shell-seeded instance. Language and theme packages stay bundle-local: they only *consume* the shared state/view APIs and carry no cross-plugin identity of their own. The shell manifest declares the two packages so vite resolves the same copies the server-side plugins type against.

Remote calls pass every declared parameter explicitly, `undefined` for an omitted optional one, at all five `checkpoint.slots` call sites (ui-reference, ui-line-note twice, ui-file-history, ui-chat). The proxy's arity check is the wire contract; optional-in-TypeScript is not optional-on-the-wire.

## Alternatives considered

- **Alias dedupe at vite only** — fixes the shell's own copy but plugin bundles are fetched and bundled by tsdown, outside vite, so aliasing cannot merge their private copies.
- **Move the gutter into ui-editor** — removes the second copy by deleting the plugin seam the note system exists to demonstrate; the `editor.cm.extension` hole is the composition contract third-party plugins will use, so the seam must survive two real consumers.
- **Loosen the typert arity check** — changes a wire-protocol runtime for one caller's convenience and weakens the catalog's parameter documentation as the single source of the call shape.

## Consequences

- Any plugin may now append CodeMirror extensions through `editor.cm.extension` without bundling its own state/view; adding a further identity-carrying library follows the same two-line platform+seed change, compile-pinned by seed's `satisfies Record<PlatformModule, unknown>`.
- The shell bundle grows by the CodeMirror core once; plugin bundles shrink by the same amount each.
- New remote methods with optional parameters must be called with explicit `undefined` from every client until the proxy learns trailing-optional elision; the catalog prose for `slots` documents both parameters, so call sites mirror it.
