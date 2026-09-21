/**
 * LSP seam vocabulary: the normalized request, provider, and result contracts. Types only — the
 * {@link LspError} taxonomy and the {@link LspProviderId} brand factory are runtime and live in
 * `index.ts`. Positions and ranges are zero-based UTF-16, matching the protocol; the model-facing
 * tool owns the one-based cursor convention. The seam exposes no protocol types, process or document
 * controls, or generic JSON-RPC escape hatch — only the four semantic operations.
 * @module @deepseek-ai/dsh-lsp/types
 */

import type { LspProviderId } from './brand.ts'

/**
 * The four semantic queries the seam and model expose. A closed union: adding an operation is a
 * compile-enforced change across the seam, providers, and the tool. Symbols and call hierarchy are
 * not operations here; they need different schemas.
 */
export type LspOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover'

/** A zero-based UTF-16 cursor coordinate, matching the LSP wire convention. */
export interface LspPosition {
  /** Zero-based line. */
  readonly line: number
  /** Zero-based UTF-16 code-unit offset within the line. */
  readonly character: number
}

/** A zero-based UTF-16 half-open range `[start, end)`. */
export interface LspRange {
  readonly start: LspPosition
  readonly end: LspPosition
}

/**
 * A caller's normalized query. Every field is required: `workspaceRoot` is caller-supplied,
 * `languageId` comes from the provider registration (not here), and consumers own timeouts and
 * result limits — so no field needs implementation defaulting and there is no `resolve()` step.
 */
export interface LspQueryRequest {
  /** Which semantic query to run. */
  readonly operation: LspOperation
  /** The source file to query (relative to `workspaceRoot` or absolute; the provider canonicalizes). */
  readonly filePath: string
  /** The zero-based UTF-16 cursor position to query at. */
  readonly position: LspPosition
  /** The workspace root the provider resolves against and indexes; required, never defaulted. */
  readonly workspaceRoot: string
}

/**
 * A request as a provider receives it: the caller's {@link LspQueryRequest} plus the `languageId`
 * the seam derived from the provider's extension mapping. The language id only synchronizes the
 * transient document; it does not participate in selection.
 */
export interface LspProviderQuery extends LspQueryRequest {
  /** The LSP language id for `filePath`, from this provider's extension mapping. */
  readonly languageId: string
}

/** One resolved location: a document URI and the range within it. */
export interface LspLocation {
  /** The target document URI (`file:` or otherwise), verbatim from the server. */
  readonly uri: string
  /** The range within the target document. */
  readonly range: LspRange
}

/** Normalized hover content, or `null` for no hover at the position. */
export interface LspHover {
  /** The normalized hover text (markdown or plaintext, provider-joined). */
  readonly contents: string
  /** The range the hover applies to, when the server supplied one. */
  readonly range?: LspRange
}

/**
 * The closed result union. Navigation operations (`goToDefinition`, `findReferences`,
 * `goToImplementation`) normalize to `locations`; `hover` normalizes to content or `null`.
 * Consumers `switch` on `kind` to exhaustiveness so a new arm breaks compilation until handled.
 *
 * The `locations` variant carries `resolvedWorkspaceUri`: the provider's canonical `file:` URI for
 * the request's workspace root. A caller that relativizes location URIs MUST use this, not parse the
 * request's possibly symlinked process path with host-platform rules; the execution platform may
 * differ from the caller's.
 */
export type LspQueryResult =
  | { readonly kind: 'locations'; readonly locations: readonly LspLocation[]; readonly resolvedWorkspaceUri: string }
  | { readonly kind: 'hover'; readonly hover: LspHover | null }

/**
 * The symbol-and-call-hierarchy operations — a parallel family to {@link LspOperation}. The
 * navigation union stays closed at four; structural and relationship queries use different
 * request/result schemas, so they live here rather than in the navigation union. Adding an operation
 * is a compile-enforced change across the seam, providers, and the tool.
 */
export type LspMapOperation = 'documentSymbols' | 'callers' | 'callees'

/**
 * A normalized symbol kind. The seam never exposes the protocol's numeric `SymbolKind` enum; the
 * provider maps the 26 kinds to this closed label union, and the model-facing tool keys presentation
 * off these labels.
 */
export type SymbolKindLabel =
  | 'file' | 'module' | 'namespace' | 'package' | 'class' | 'method' | 'property'
  | 'field' | 'constructor' | 'enum' | 'interface' | 'function' | 'variable'
  | 'constant' | 'string' | 'number' | 'boolean' | 'array' | 'object' | 'key'
  | 'null' | 'enumMember' | 'struct' | 'event' | 'operator' | 'typeParameter'

/**
 * A normalized symbol node — the common ancestor of {@link LspDocumentSymbol} and the peers of a
 * {@link LspCallEdge}. `detail` is the only disambiguator for same-named symbols and is present only
 * when the server supplied one.
 */
export interface LspSymbol {
  /** The symbol's declared name. */
  readonly name: string
  /** The normalized symbol kind. */
  readonly kind: SymbolKindLabel
  /** Signature / container text the server supplied; absent when it did not. */
  readonly detail?: string
  /** Whether the server tagged the symbol `deprecated`. */
  readonly deprecated?: boolean
  /** The containing document URI. */
  readonly uri: string
  /** The symbol's full extent (declaration rail through body). */
  readonly range: LspRange
  /** The name token's extent — the jump target. */
  readonly selectionRange: LspRange
}

/**
 * A hierarchical document symbol. Document-scoped, so it carries no `uri` — the queried document is
 * implied by the request. `children` makes the outline a tree; the leaf fields mirror {@link LspSymbol}
 * minus the URI.
 */
export interface LspDocumentSymbol {
  readonly name: string
  readonly kind: SymbolKindLabel
  readonly detail?: string
  readonly deprecated?: boolean
  readonly range: LspRange
  readonly selectionRange: LspRange
  readonly children: readonly LspDocumentSymbol[]
}

/**
 * One directed call edge: `from` calls `to` at every `sites` range in `from`'s document. `sites` is
 * the protocol's `fromRanges` — the physical call expressions, exactly what text search cannot see.
 */
export interface LspCallEdge {
  readonly from: LspSymbol
  readonly to: LspSymbol
  readonly sites: readonly LspRange[]
}

/**
 * A normalized structural/relationship query. `documentSymbols` is document-scoped (no cursor);
 * `callers`/`callees` are cursor-scoped. Every field is required within its variant; the provider
 * canonicalizes `filePath` against `workspaceRoot` exactly as the navigation seam does.
 */
export type LspMapRequest =
  | { readonly operation: 'documentSymbols'; readonly filePath: string; readonly workspaceRoot: string }
  | { readonly operation: 'callers' | 'callees'; readonly filePath: string; readonly workspaceRoot: string; readonly position: LspPosition }

/** A map request as a provider receives it: the caller's {@link LspMapRequest} plus the derived language id. */
export type LspMapProviderQuery = LspMapRequest & { readonly languageId: string }

/**
 * The closed map result union. `documentSymbols` normalizes to a `symbolTree`; `callers`/`callees`
 * normalize to `callEdges` (a root plus one hop of edges, or a `null` root when prepare found no
 * symbol at the cursor). Consumers `switch` on `kind` to exhaustiveness. The `callEdges` variant
 * carries `resolvedWorkspaceUri` for the same reason the `locations` variant does: URI relativization
 * must use the provider's canonical workspace URI.
 */
export type LspMapResult =
  | { readonly kind: 'symbolTree'; readonly symbols: readonly LspDocumentSymbol[] }
  | { readonly kind: 'callEdges'; readonly root: LspSymbol | null; readonly edges: readonly LspCallEdge[]; readonly resolvedWorkspaceUri: string }

/**
 * A language-server backend registered on `ctx.lsp`. Each provider owns a stable {@link
 * LspProviderId} and an extension-to-language-id map (lowercase, leading-dot keys).
 * `findReferences` always includes declarations — the provider enforces this internally; callers
 * get no flag.
 */
export interface LspProvider {
  /** Stable provider identity, reserved atomically with the extension mappings. */
  readonly id: LspProviderId
  /** Lowercase leading-dot extension → LSP language id (e.g. `{ '.ts': 'typescript' }`). */
  readonly extensionToLanguage: Readonly<Record<string, string>>
  /**
   * Run one query. The seam has already selected this provider and derived `languageId`.
   * @param request - the resolved provider query (caller request + derived language id).
   * @param signal - optional cancellation; the provider stops its own work when it aborts.
   * @returns the normalized, closed-union result.
   */
  query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult>
  /**
   * Run one structural/relationship query. The seam has already selected this provider and derived
   * `languageId`.
   * @param request - the resolved map query (caller request + derived language id).
   * @param signal - optional cancellation; the provider stops its own work when it aborts.
   * @returns the normalized, closed-union map result.
   */
  mapQuery(request: LspMapProviderQuery, signal?: AbortSignal): Promise<LspMapResult>
}

/** One currently registered extension → language route, for coverage introspection only. */
export interface LspRoute {
  /** Lowercase leading-dot extension (e.g. `.go`). */
  readonly extension: string
  /** The LSP language id this extension resolves to. */
  readonly languageId: string
}

/**
 * The LSP capability seam (`ctx.lsp`). Owns provider registration/selection and normalized query
 * execution; exposes exactly the four operations and no protocol escape hatch.
 */
export interface LspService {
  /**
   * Register a provider, atomically reserving its id and every normalized extension. Any conflict
   * or invalid input publishes nothing and throws `LspError`; the returned disposer releases all
   * reservations. Disposed with the calling fiber.
   * @param provider - the backend to register.
   * @returns a synchronous disposer releasing the id and all extension reservations.
   */
  registerProvider(provider: LspProvider): () => void
  /**
   * Select a provider by the file's extension and run one query. Selection is per-query and
   * order-independent; no match throws `LspError` `LSP_UNAVAILABLE`.
   * @param request - the normalized query.
   * @param signal - optional cancellation forwarded to the selected provider.
   * @returns the normalized, closed-union result.
   */
  query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult>
  /**
   * Select a provider by the file's extension and run one structural/relationship query. Selection is
   * per-query and order-independent, sharing the extension table with navigation queries; no match
   * throws `LspError` `LSP_UNAVAILABLE`.
   * @param request - the normalized map query.
   * @param signal - optional cancellation forwarded to the selected provider.
   * @returns the normalized, closed-union map result.
   */
  mapQuery(request: LspMapRequest, signal?: AbortSignal): Promise<LspMapResult>
  /**
   * List every currently registered extension → language route. For introspection only (e.g.
   * describing live coverage in prompt guidance) — `query()` remains the seam's actual lookup, and
   * this snapshot is not ordered by registration or priority.
   * @returns the routes sorted by extension.
   */
  listRoutes(): readonly LspRoute[]
}
