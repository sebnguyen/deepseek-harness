# Agent Note: LSP folder map — symbol + call-hierarchy mapping

Status: proposed (sketch — code-change plan, not yet implemented)

## Problem

Code discovery today is grep/glob/read only; the `lsp` tool exposes four position-scoped navigation ops (`goToDefinition`/`findReferences`/`goToImplementation`/`hover`) and nothing structural. There is no way to map a folder: no `documentSymbol` outline, no call hierarchy, no "what calls what". The node tool (`knowledge-notes`) records per-file gotchas but does not solve *discovery*. This change adds a folder-scale symbol map built from LSP `textDocument/documentSymbol` plus `prepareCallHierarchy`/`incomingCalls`/`outgoingCalls`.

## Product contract (pinned, model-visible)

Batch outline, one line per file, ASCII-only (no `↑`/`↓` glyphs — they byte-split under BPE):

```
api/workspace-controller/directory-picker.ts: [ :14 (func) pick in:1 out:0 ; :31 (func) resolve in:4 out:3 ]
```

- `in:` = incoming callers · `out:` = outgoing callees. Legend pinned in the tool description + output header.
- `kind→abbrev` table pinned once (`func`/`class`/`method`/`iface`/`enum`/`var`/`const`/`field`/…); the rest collapse.
- Caps cascade `filesPerBatch → symbolsPerFile → bytesPerBatch`; overflow shows `… +N more symbols` per file; the complete structured result spills to a formatted file (reuse `tool-fs-search` spill).
- Exact call edges are lazy, full-word ("callers of … / callees of …"), pulled one hop on a named symbol.

## Change surface

### 1. `packages/lsp/lsp` — seam data structures

**`src/types.ts`** — a *parallel* operation family (the nav union stays closed at four):

```ts
export type LspMapOperation = 'documentSymbols' | 'callers' | 'callees'

/** 26 SymbolKind values, normalized to readable labels (no numeric enum crosses the seam). */
export type SymbolKindLabel =
  | 'file' | 'module' | 'namespace' | 'package' | 'class' | 'method' | 'property'
  | 'field' | 'constructor' | 'enum' | 'interface' | 'function' | 'variable'
  | 'constant' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'key'
  | 'null' | 'enumMember' | 'struct' | 'event' | 'operator' | 'typeParameter'

/** A normalized symbol / call-hierarchy node (DocumentSymbol minus children, CallHierarchyItem). */
export interface LspSymbol {
  readonly name: string
  readonly kind: SymbolKindLabel
  /** Signature / container text; only present when the server sends it — the disambiguator. */
  readonly detail?: string
  readonly deprecated?: boolean
  readonly uri: string
  readonly range: LspRange
  readonly selectionRange: LspRange
}

/** Hierarchical document symbol — recursion is what makes it a tree. */
export interface LspDocumentSymbol extends LspSymbol {
  readonly children: readonly LspDocumentSymbol[]
}

/** One directed call edge: `from` calls `to` at the `sites` ranges in `from`'s document. */
export interface LspCallEdge {
  readonly from: LspSymbol
  readonly to: LspSymbol
  readonly sites: readonly LspRange[]   // protocol fromRanges = the physical call sites
}

/** Discriminated request: `documentSymbols` is position-free; `callers`/`callees` carry a cursor. */
export type LspMapRequest =
  | { readonly operation: 'documentSymbols'; readonly filePath: string; readonly workspaceRoot: string }
  | { readonly operation: 'callers' | 'callees'; readonly filePath: string; readonly workspaceRoot: string; readonly position: LspPosition }

/** Provider-side request (languageId appended by selection, same as LspProviderQuery). */
export type LspMapProviderQuery = LspMapRequest & { readonly languageId: string }

export type LspMapResult =
  | { readonly kind: 'symbolTree'; readonly symbols: readonly LspDocumentSymbol[] }
  | { readonly kind: 'callEdges'; readonly root: LspSymbol; readonly edges: readonly LspCallEdge[]; readonly resolvedWorkspaceUri: string }
```

**`src/types.ts` — provider + service additions** (the new method ripples to every provider, exactly like a new nav operation does today):

```ts
export interface LspProvider {
  // …existing fields…
  mapQuery(request: LspMapProviderQuery, signal?: AbortSignal): Promise<LspMapResult>
}

export interface LspService {
  // …existing methods…
  mapQuery(request: LspMapRequest, signal?: AbortSignal): Promise<LspMapResult>
}
```

**`src/index.ts`** — route `mapQuery` through the same `finalExtension()` selection; re-export the new types.

### 2. `packages/lsp/lsp-stdio` — provider wire + translation

**`src/protocol.ts`** — wire shapes + server capabilities:

```ts
export interface WireDocumentSymbol {
  readonly name: string
  readonly detail?: string
  readonly kind: number                      // raw SymbolKind enum
  readonly tags?: readonly number[]
  readonly deprecated?: boolean
  readonly range: WireRange
  readonly selectionRange: WireRange
  readonly children?: readonly WireDocumentSymbol[]
}

export interface WireCallHierarchyItem {
  readonly name: string
  readonly kind: number
  readonly tags?: readonly number[]
  readonly detail?: string
  readonly uri: string
  readonly range: WireRange
  readonly selectionRange: WireRange
  readonly data?: unknown                    // opaque; preserved for a later resolve
}

export interface WireIncomingCall { readonly from: WireCallHierarchyItem; readonly fromRanges: readonly WireRange[] }
export interface WireOutgoingCall { readonly to: WireCallHierarchyItem; readonly fromRanges: readonly WireRange[] }

export interface WireServerCapabilities {
  // …existing fields…
  readonly documentSymbolProvider?: WireProviderCapability
  readonly callHierarchyProvider?: WireProviderCapability
  readonly workspaceSymbolProvider?: WireProviderCapability
}
```

**`src/translate.ts`** — normalizers (pure, fake-stdio-pinned like the existing ones):

```ts
export function mapRequestMethod(operation: LspMapOperation): string
// 'documentSymbols' → 'textDocument/documentSymbol'
// 'callers'/'callees' → 'textDocument/prepareCallHierarchy'

export function normalizeDocumentSymbols(payload: unknown): LspDocumentSymbol[]
export function normalizeCallItem(payload: unknown): LspSymbol                      // prepareCallHierarchy result
export function normalizeIncomingCalls(root: LspSymbol, payload: unknown): LspCallEdge[]
export function normalizeOutgoingCalls(root: LspSymbol, payload: unknown): LspCallEdge[]
function symbolKindLabel(kind: number): SymbolKindLabel                              // 1..26 → label; unknown → LSP_MALFORMED_RESPONSE
```

**`src/instance.ts`** — the two round-trips `callers`/`callees` need (prepare → incoming/outgoing), which today's single-request `sendRequest`/`normalize` cannot express:

```ts
private async runMapQuery(request: LspMapProviderQuery, source: HostSource, signal?: AbortSignal): Promise<LspMapResult>
// documentSymbols: one request; callers/callees: prepare then callHierarchy/incomingCalls|outgoingCalls on the item.
```

Advertise the features (a well-behaved server returns nothing otherwise):

```ts
const CLIENT_CAPABILITIES = {
  // …existing…
  workspace: { workspaceFolders: true, configuration: true, symbol: {} },
  textDocument: {
    // …existing…
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    callHierarchy: {},
  },
} as const
```

### 3. `packages/lsp/tool-lsp` — lazy edge ops on the existing tool

Add `callers`/`callees` to the `lsp` tool (same `file:line` ergonomics). **`src/index.ts`**:

```ts
export const MAP_OPERATIONS: readonly LspMapOperation[] = ['callers', 'callees']   // documentSymbols lives in the batch tool

export function parseMapArgs(args: LspToolArgs): LspMapRequest   // reuses one-based→zero-based conversion

// output.schema adds the callEdges variant; render:
export function renderCallEdges(value: LspMapResult & { kind: 'callEdges' }): string
```

**`src/render.ts`** — full-word, one-hop rendering (the "callers of … / callees of …" tree from the format contract):

```ts
export function formatCallEdges(root: LspSymbol, edges: readonly LspCallEdge[], workspaceUri: string, maxResultChars: number): string
```

### 4. `packages/lsp/tool-lsp-map` — new batch consumer (new package)

Injects `tools`, `lsp`, `systemPrompt`; reads `spillStore` via `ctx.get()`. Owns the folder-map composition.

**`src/index.ts`**:

```ts
export const name = 'tool-lsp-map'
export const inject = ['tools', 'lsp', 'systemPrompt']

export interface Config {
  filesPerBatch: number          // default ~100, then spill
  symbolsPerFile: number         // default ~200, then '… +N more symbols'
  bytesPerBatch: number          // default ~16k rendered chars
  hotspots: boolean              // default false — in/out counts cost 2× round-trips per symbol
  topHotspots: number            // default 0 (deferred path-edges)
}

export function apply(ctx: Context, config: Config): void
export function applySymbolsTool(ctx: Context, caps: ResolvedConfig): void
```

**`src/symbols.ts`** — the batch tool + composition + format:

```ts
export interface SymbolLine {
  readonly name: string
  readonly kind: SymbolKindLabel
  readonly line: number                       // one-based selectionRange.start.line
  readonly callers: number | undefined        // populated only when hotspots
  readonly callees: number | undefined
}

export interface FileOutline {
  readonly path: string
  readonly symbols: readonly SymbolLine[]
  readonly truncated: boolean                 // symbolsPerFile hit → '… +N more symbols'
}

export interface SymbolsInput { readonly files: readonly string[]; readonly hotspots?: boolean }

export async function runSymbols(ctx: Context, input: SymbolsInput, signal: AbortSignal): Promise<FileOutline[]>

export function formatLayout(outlines: readonly FileOutline[], caps: SymbolsCaps): string
//                 ^ emits the pinned "path: [ :line (abbrev) name in:n out:m ; … ]" ASCII form

export function renderSymbols(args: SymbolsInput, value: FileOutline[]): object   // + spill to formatted file
```

**`src/kind.ts`** — the pinned abbreviations (model-visible table, snapshot-locked):

```ts
export const KIND_ABBREV: Readonly<Record<SymbolKindLabel, string>> = {
  'class': 'class', 'interface': 'iface', 'method': 'method', 'function': 'func',
  'enum': 'enum', 'constructor': 'ctor', 'variable': 'var', 'constant': 'const',
  'field': 'field', 'property': 'prop', 'typeParameter': 'type',
  // …remaining kinds → absent from the map (collapsed)…
}
export const SYMBOL_KEEP: ReadonlySet<SymbolKindLabel>   // map-worthy vs collapsed noise
```

**`src/present.ts`** — replay-safe UI card (the `read`-tool `presentResult` pattern):

```ts
export interface SymbolMapView { card: 'map'; path: string; symbols: readonly SymbolLine[] }
export function presentSymbolsResult(_args: SymbolsInput, result: ToolResult): SymbolMapView | undefined
export function presentSymbolsCall(args: SymbolsInput): GenericCallView
```

## Wiring — plugin, ctx keys, session events, system prompt

### Plugin added

One new plugin; the rest are edits to existing packages.

| Plugin | Package | Change |
|---|---|---|
| **`tool-lsp-map`** (new) | `packages/lsp/tool-lsp-map` | function plugin `name`/`inject`/`Config`/`apply`; registers `symbols` |
| `tool-lsp` | `packages/lsp/tool-lsp` | gains `callers`/`callees` ops + extended guidance |
| `lsp` | `packages/lsp/lsp` | `LspService`/`LspProvider` gain `mapQuery` (still keyed `lsp`) |
| `lsp-stdio` | `packages/lsp/lsp-stdio` | wire types + normalizers + dispatch + capabilities; no new plugin/service |

### ctx keys

- No new service: the seam stays keyed `lsp`, gaining only `mapQuery(request: LspMapRequest, signal?): Promise<LspMapResult>`.
- `tool-lsp-map` injects `['tools', 'lsp', 'systemPrompt']`; it reads the optional `spillStore` with `ctx.get('spillStore')` (the `ctx.get` rule — never broadened into `inject`).
- `tool-lsp` keeps `inject = ['tools', 'lsp', 'systemPrompt']`.
- Workspace root resolves via the existing `sessionCwd(exec)`; the tools take explicit `files`, so nothing injects `fs` (the provider already reads sources through `ctx.fs`).

### Session event emission

There is no new session event: the three surfaces are tools registered through `ctx.tools`, so they log the ordinary `tool/call` + `tool/result` records — like today's `lsp`/`glob`/`grep`. "Model-visible ⟺ logged" is already satisfied by the tool-log path.

- The `symbols` result persists a `presentationMeta` (the structured `map` view on `tool/result.meta`) so the UI card is replay-safe — the `read`-tool pattern. No `SessionEventMap` member, no `SESSION_FORMAT_VERSION` bump.
- No `fs/observed`: sources are read through the language server (inside the provider), not a guarded `read` mutation.

### System prompt

Both additions are `system prompt` sections through `ctx.systemPrompt.section(...)`:

- `tool-lsp` extends `LSP_PROMPT_TEXT` (`TOOL_LSP` order) to name `callers`/`callees` — "one hop of precise call sites, expanded one chosen symbol per call".
- New `tool-lsp-map` section (fixed order, mirroring `knowledge-notes`'s `NOTE_SECTION_ORDER`) carrying the `symbols` contract ("pipe a `glob` result into `symbols` to map a folder before read cycles"), the pinned legend (`in:` = incoming callers, `out:` = outgoing callees), and the pinned `KIND_ABBREV` table — so the model never infers an abbreviation.
- Optional follow-up: `tool:lsp-coverage` (`describeLspCoverage`) grows capability-aware — but `listRoutes()` today knows only extension→languageId, so reporting whether the live server advertises `documentSymbol`/`callHierarchy` needs the seam to first surface negotiated capabilities.

## Flow

```
glob(files)  →  symbols(files, hotspots?)  →  documentSymbols per file  →  formatLayout  →  spill + map card
symbols (hotspots:true)  →  per symbol: callers()/callees() → lengths only → in:n out:m
lsp(callers|callees, file:line)  →  one hop of precise call sites (the thing grep cannot do)
```

## PR split

1. `dsh-lsp` seam types only (compiles to "unimplemented" in `lsp-stdio`).
2. `lsp-stdio` wire types + normalizers + dispatch + capabilities, gated behind capability.
3. `tool-lsp` `callers`/`callees` ops + render + snapshot.
4. `tool-lsp-map` `symbols` tool + format + spill + `map` card + snapshot.
5. (optional) parallelism fan-out — the serialized per-workspace queue is the batch bottleneck.

## Tests

Per-package behavior tests; a REAL-composition test (test `cordis.yml` through the Loader) for the two product-visible tools; keyless recorded-session snapshots for both new model-facing formats; e2e against a real TS/Go server gated on provider availability. Coverage gate is `test:coverage` per the repo standard.

## Open decisions

1. Ship `hotspots` (in/out counts) in v1, or layout-only first? (counts = the slowest phase: 2× round-trips per symbol over the serialized queue.)
2. Include `workspaceSymbols` now or defer? (query-not-dump; may not pay next to grep.)
3. Tool naming: `symbols` vs `map` vs `batch_lsp`.
4. Hotspot score: `in+out` total degree, or weight fan-in (`in`) higher — decides which symbols get deferred path-edges.

## Risks

- Call-graph fan-out is O(edges); every eager edge we materialize feeds the compression budget we are trying to save.
- Single-letter or glyph tokens (`↑`, `i:`) fragment under BPE — the format stays ASCII-words (`in:`/`out:`) and is snapshot-pinned.
- `documentSymbols` across N files hits the provider's serialized per-workspace queue; `filesPerBatch` absorbs it until PR 5.
