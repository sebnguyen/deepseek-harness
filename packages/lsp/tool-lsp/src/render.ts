/**
 * Pure formatting and coordinate conversion for the `lsp` tool: one-based↔zero-based UTF-16 cursor
 * conversion, workspace-grouped location rendering with `file:`-URI resolution, complete-result
 * capping, and UI presentation. No I/O — a UI may call the presenter on live streaming and on
 * replay, so it depends only on the tool arguments.
 * @module @deepseek-ai/dsh-tool-lsp/render
 */

import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { LspHover, LspLocation, LspOperation, LspPosition, LspRoute } from '@deepseek-ai/dsh-lsp'
import { posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The four navigation operations the tool exposes, as a runtime tuple for schema enum + validation. */
export const LSP_OPERATIONS: readonly LspOperation[] = ['goToDefinition', 'findReferences', 'goToImplementation', 'hover']

/** Every operation the tool accepts: the four navigation ops plus the two one-hop relationship ops. */
export type ToolOperation = LspOperation | 'callers' | 'callees'

/** The full operation tuple for schema enum + validation. */
export const TOOL_OPERATIONS: readonly ToolOperation[] = [...LSP_OPERATIONS, 'callers', 'callees']

/** Default cap on rendered locations before an omission marker is appended. */
export const DEFAULT_MAX_LOCATIONS = 100

/** Default cap on the complete rendered tool result, including truncation metadata. */
export const DEFAULT_MAX_RESULT_CHARS = 16_000

/** Validated `lsp` arguments after coordinate checks. */
export interface LspToolInput {
  readonly operation: ToolOperation
  readonly filePath: string
  /** Zero-based UTF-16 position converted from the one-based model coordinates. */
  readonly position: LspPosition
}

/** The raw, schema-typed argument shape. */
export interface LspToolArgs {
  readonly operation: string
  readonly file_path: string
  readonly line: number
  readonly character: number
}

/**
 * Validate and convert model arguments: `operation` must be one of the four; `line`/`character` are
 * positive one-based integers converted to the seam's zero-based position.
 * @param args - the schema-validated raw arguments.
 * @returns the validated input with a zero-based position.
 * @throws Error when the operation is unknown or a coordinate is not a positive integer.
 */
export function parseLspArgs(args: LspToolArgs): LspToolInput {
  if (!isOperation(args.operation)) {
    throw new Error(`operation must be one of ${TOOL_OPERATIONS.join(', ')}`)
  }
  if (args.file_path.trim().length === 0) throw new Error('file_path must be a non-empty string')
  const line = oneBased(args.line, 'line')
  const character = oneBased(args.character, 'character')
  return {
    operation: args.operation,
    filePath: args.file_path,
    // The model counts from 1; the seam (and protocol) count from 0.
    position: { line: line - 1, character: character - 1 },
  }
}

/** Whether a string is one of the tool's operations. */
function isOperation(value: string): value is ToolOperation {
  return (TOOL_OPERATIONS as readonly string[]).includes(value)
}

/** Validate a one-based coordinate is a positive integer. */
function oneBased(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer (one-based)`)
  }
  return value
}

/**
 * Render a locations result grouped by file, converting each zero-based location back to a one-based
 * `path:line:character` entry. A `file:` URI inside the workspace becomes a workspace-relative path;
 * outside it, a URI-derived absolute path; a non-`file:` URI is kept verbatim. Applies `maxLocations` and
 * appends an omission marker when it truncates by count, then applies the complete result cap.
 * @param locations - the seam's locations (possibly empty).
 * @param workspaceUri - the provider's canonical workspace `file:` URI.
 * @param maxLocations - the cap before truncation.
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered text; a distinct no-result line when there are none.
 */
export function formatLocations(
  locations: readonly LspLocation[],
  workspaceUri: string,
  maxLocations: number,
  maxResultChars: number,
): string {
  if (locations.length === 0) return boundResult('No results.', maxResultChars, 'locations')
  const shown = locations.slice(0, maxLocations)
  const omitted = locations.length - shown.length
  const grouped = new Map<string, string[]>()
  for (const location of shown) {
    const path = renderUri(location.uri, workspaceUri)
    const line = location.range.start.line + 1
    const character = location.range.start.character + 1
    const entries = grouped.get(path) ?? []
    entries.push(`${path}:${line}:${character}`)
    grouped.set(path, entries)
  }
  const lines: string[] = []
  for (const entries of grouped.values()) lines.push(...entries)
  if (omitted > 0) {
    lines.push(`… ${omitted} more location${omitted === 1 ? '' : 's'} omitted (limit ${maxLocations}).`)
  }
  return boundResult(lines.join('\n'), maxResultChars, 'locations')
}

/**
 * Render a hover result, applying `maxResultChars` last and keeping its marker within the cap.
 * @param hover - the normalized hover, or `null` for no hover.
 * @param maxResultChars - the complete rendered-text cap, including truncation metadata.
 * @returns the rendered hover text; a distinct no-result line for `null`.
 */
export function formatHover(hover: LspHover | null, maxResultChars: number): string {
  const text = hover === null ? 'No hover information.' : hover.contents
  return boundResult(text, maxResultChars, 'hover')
}

/**
 * The minimal symbol fields the call-edge renderer reads. Loose (`kind: string`) so both the seam's
 * `LspSymbol` and the output-schema `InferValue` fit without a cast.
 */
export interface CallEdgeSymbolView {
  readonly name: string
  readonly kind: string
  readonly uri: string
  readonly selectionRange: { readonly start: { readonly line: number } }
}

/** The minimal edge fields the call-edge renderer reads. */
export interface CallEdgeView {
  readonly from: CallEdgeSymbolView
  readonly to: CallEdgeSymbolView
  readonly sites: readonly { readonly start: { readonly line: number } }[]
}

/**
 * Render one hop of call edges in the full-word "callers of / callees of" tree. `root` is `null` when
 * prepare found no symbol at the cursor. Each edge lists its peer symbol and the physical call sites
 * (`fromRanges`) — the exact call expressions text search cannot see.
 * @param root - the queried symbol, or null.
 * @param edges - the one-hop edges (callers or callees).
 * @param direction - which relationship the edges express.
 * @param workspaceUri - the provider's canonical workspace URI for path relativization.
 * @param maxResultChars - the complete rendered-text cap.
 * @returns the rendered tree.
 */
export function formatCallEdges(
  root: CallEdgeSymbolView | null,
  edges: readonly CallEdgeView[],
  direction: 'callers' | 'callees',
  workspaceUri: string,
  maxResultChars: number,
): string {
  if (root === null) return boundResult('No symbol at this cursor.', maxResultChars, 'callEdges')
  const label = direction === 'callers' ? 'callers of' : 'callees of'
  const header = `${label} ${root.name} (${root.kind}) — ${renderUri(root.uri, workspaceUri)}:${root.selectionRange.start.line + 1}`
  if (edges.length === 0) return boundResult(`${header}\n(no ${direction})`, maxResultChars, 'callEdges')
  const body = edges.map((edge) => {
    const peer = direction === 'callers' ? edge.from : edge.to
    const sites = edge.sites.map(site => `${renderUri(edge.from.uri, workspaceUri)}:${site.start.line + 1}`).join(', ')
    return `  ${peer.name} (${peer.kind}) — ${renderUri(peer.uri, workspaceUri)}:${peer.selectionRange.start.line + 1} (call site ${sites})`
  })
  return boundResult([header, ...body].join('\n'), maxResultChars, 'callEdges')
}

/**
 * Describe live `lsp` coverage from the seam's currently registered routes, for the dynamic
 * `tool:lsp-coverage` prompt section (`TOOL_LSP_COVERAGE`). Contributes nothing when no provider is
 * registered, matching the empty-section convention for an absent capability.
 * @param routes - `ctx.lsp.listRoutes()`'s live snapshot.
 * @returns one guidance sentence naming every covered extension, or `''`.
 */
export function describeLspCoverage(routes: readonly LspRoute[]): string {
  if (routes.length === 0) return ''
  const list = routes.map(({ extension, languageId }) => `${extension} (${languageId})`).join(', ')
  return `lsp currently covers: ${list}. A file outside these extensions returns LSP_UNAVAILABLE — use search/read for it instead of retrying lsp.`
}

/** Bound a complete rendered result, including the truncation notice itself. */
function boundResult(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text
  const notice = `\n… ${label} truncated (limit ${maxChars} characters).`
  if (notice.length >= maxChars) return notice.slice(0, maxChars)
  return `${text.slice(0, maxChars - notice.length)}${notice}`
}

/**
 * Resolve a location URI without applying the harness host's path rules. A valid `file:` URI becomes
 * workspace-relative when it is under the provider's canonical workspace URI, or a URI-derived
 * absolute path otherwise; malformed and non-`file:` URIs remain verbatim.
 * @param uri - the target URI from the seam.
 * @param workspaceUri - the provider's canonical workspace `file:` URI.
 * @returns the display path or the verbatim URI.
 */
export function renderUri(uri: string, workspaceUri: string): string {
  if (!uri.startsWith('file:')) return uri
  let target: URL
  let workspace: URL
  try {
    target = new URL(uri)
    workspace = new URL(workspaceUri)
  } catch {
    return uri
  }
  if (workspace.protocol !== 'file:') return uri
  // A `file:` URI does not carry its world's OS, so a leading `/X:` segment is
  // read as a Windows drive. A POSIX workspace literally rooted at `/c:/...`
  // would mis-render (display only; edits and reads use the exact URI).
  const drivePath = /^\/[a-z](?::|%3A)/iu
  const windowsWorld = workspace.hostname.length > 0 || drivePath.test(workspace.pathname)
  const targetWindowsWorld = windowsWorld && (target.hostname.length > 0 || drivePath.test(target.pathname))
  const workspacePath = filePath(workspace, windowsWorld)
  const targetPath = filePath(target, targetWindowsWorld)
  if (workspacePath === undefined || targetPath === undefined) return uri
  if (windowsWorld !== targetWindowsWorld) return targetPath
  const path = windowsWorld ? win32 : posix
  const relative = path.relative(workspacePath, targetPath)
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  const rendered = relative === '' ? '.' : outside ? targetPath : relative
  return windowsWorld ? rendered.replaceAll('\\', '/') : rendered
}

/** Decode a file URL for its execution world while containing malformed URL failures. */
function filePath(url: URL, windows: boolean): string | undefined {
  try {
    const path = fileURLToPath(url, { windows })
    return path.includes('\0') ? undefined : path
  } catch {
    // `fileURLToPath` rejects malformed escapes, authorities, and encoded path separators.
    return undefined
  }
}

/**
 * UI presentation for a pending `lsp` call. Uses a generic search card; the title carries the
 * operation and one-based cursor, and `locations` focuses the queried line. The shared location
 * shape has no character, so the title preserves the column.
 * @param args - the raw tool arguments.
 * @returns the generic call view.
 */
export function presentLspCall(args: LspToolArgs): GenericCallView {
  return {
    card: 'generic',
    kind: 'search',
    title: `LSP ${args.operation} ${args.file_path}:${args.line}:${args.character}`,
    locations: [{ path: args.file_path, line: args.line }],
  }
}
