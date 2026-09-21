/**
 * Pure protocol translation for the local host: what the server's capabilities allow, and how its
 * `Location`/`LocationLink`/`Hover` payloads normalize into the seam's closed result unions. No I/O
 * or process state — every function here is a pure transform, which the fake-stdio tests pin exactly.
 * @module @deepseek-ai/dsh-lsp-stdio/translate
 */

import type {
  LspCallEdge,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspMapOperation,
  LspOperation,
  LspRange,
  LspSymbol,
  SymbolKindLabel,
} from '@deepseek-ai/dsh-lsp'
import { LspError } from '@deepseek-ai/dsh-lsp'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {
  WireHover,
  WireLocation,
  WireLocationLink,
  WireMarkedString,
  WireProviderCapability,
  WireRange,
  WireServerCapabilities,
  WireTextDocumentSyncKind,
} from './protocol.ts'

/**
 * The `textDocument/*` request method for each LSP operation.
 * @param operation - the LSP operation to map.
 * @returns the LSP request method name.
 */
export function requestMethod(operation: LspOperation): string {
  switch (operation) {
    case 'goToDefinition': return 'textDocument/definition'
    case 'findReferences': return 'textDocument/references'
    case 'goToImplementation': return 'textDocument/implementation'
    case 'hover': return 'textDocument/hover'
    /* v8 ignore next -- exhaustive over the closed LspOperation union; unreachable. */
    default: return assertNever(operation, 'requestMethod')
  }
}

/** The `ServerCapabilities` provider field backing each operation. */
function capabilityValue(capabilities: WireServerCapabilities, operation: LspOperation): WireProviderCapability {
  switch (operation) {
    case 'goToDefinition': return capabilities.definitionProvider
    case 'findReferences': return capabilities.referencesProvider
    case 'goToImplementation': return capabilities.implementationProvider
    case 'hover': return capabilities.hoverProvider
    /* v8 ignore next -- exhaustive over the closed LspOperation union; unreachable. */
    default: return assertNever(operation, 'capabilityValue')
  }
}

/** A provider capability is present when the server sent `true` or an options object (not `false`/absent). */
function supportsCapability(value: WireProviderCapability): boolean {
  if (value === undefined) return false
  if (typeof value === 'boolean') return value
  return true
}

/**
 * Whether the server advertises the requested operation.
 * @param capabilities - the server's `initialize` capabilities.
 * @param operation - the LSP operation to check.
 * @returns true when the corresponding provider capability is present.
 */
export function supportsOperation(capabilities: WireServerCapabilities, operation: LspOperation): boolean {
  return supportsCapability(capabilityValue(capabilities, operation))
}

/**
 * Whether a `textDocumentSync` value permits the transient `didOpen`/`didClose` this host relies on.
 * The legacy enum form implies open/close for `Full`/`Incremental`; the options form requires an
 * explicit `openClose: true`, because the protocol defaults an omitted `openClose` to false.
 * @param sync - the server's advertised `textDocumentSync` capability.
 * @returns true when transient open/close is supported.
 */
export function supportsTransientOpen(sync: WireServerCapabilities['textDocumentSync']): boolean {
  if (sync === undefined) return false
  if (typeof sync === 'number') return isOpenCloseKind(sync)
  return sync.openClose === true
}

/** Legacy enum: `Full` (1) or `Incremental` (2) imply open/close support; `None` (0) does not. */
function isOpenCloseKind(kind: WireTextDocumentSyncKind): boolean {
  return kind === 1 || kind === 2
}

/**
 * Normalize the negotiated position encoding. An omitted encoding defaults to `utf-16`; any value
 * other than `utf-16` is a protocol error this host does not support.
 * @param encoding - the server's advertised `positionEncoding`, if any.
 * @returns the string `'utf-16'`.
 * @throws Error for any non-`utf-16` encoding.
 */
export function negotiatePositionEncoding(encoding: string | undefined): 'utf-16' {
  if (encoding === undefined || encoding === 'utf-16') return 'utf-16'
  throw new Error(`server negotiated unsupported position encoding "${encoding}"; this host requires utf-16`)
}

/** Convert a wire range to the seam's range (structurally identical, but re-shaped as `readonly`). */
function toRange(range: WireRange): LspRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  }
}

/** Whether a record is a `LocationLink` (has `targetUri` + `targetSelectionRange`). */
function isLocationLink(value: Record<string, unknown>): boolean {
  return typeof value.targetUri === 'string' && isRange(value.targetSelectionRange)
}

/** Whether a record is a `Location` (has string `uri` + a range). */
function isLocation(value: Record<string, unknown>): boolean {
  return typeof value.uri === 'string' && isRange(value.range)
}

/** Structural range guard used by both location shapes. */
function isRange(value: unknown): value is WireRange {
  if (value === null || typeof value !== 'object') return false
  const range = value as Record<string, unknown>
  return isPosition(range.start) && isPosition(range.end)
}

/** Structural position guard. */
function isPosition(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const position = value as Record<string, unknown>
  return isProtocolCoordinate(position.line) && isProtocolCoordinate(position.character)
}

/** Whether a wire coordinate is a valid nonnegative integer. */
function isProtocolCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * Normalize a navigation result (`Location`, `Location[]`, `LocationLink[]`, or `null`) to the seam's
 * locations. `Location` maps directly; `LocationLink` maps `targetUri` + `targetSelectionRange`.
 * @param payload - the raw `textDocument/definition|references|implementation` result.
 * @returns the normalized locations (empty for `null`/`[]`).
 * @throws Error when an element is neither a `Location` nor a `LocationLink`.
 */
export function normalizeLocations(payload: unknown): LspLocation[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP navigation result was missing')
  const elements = Array.isArray(payload) ? payload : [payload]
  const locations: LspLocation[] = []
  for (const element of elements) {
    if (element === null || typeof element !== 'object') {
      throw malformedResponse('LSP navigation result contained a non-object entry')
    }
    const record = element as Record<string, unknown>
    if (isLocationLink(record)) {
      const link = record as unknown as WireLocationLink
      locations.push({ uri: link.targetUri, range: toRange(link.targetSelectionRange) })
    } else if (isLocation(record)) {
      const location = record as unknown as WireLocation
      locations.push({ uri: location.uri, range: toRange(location.range) })
    } else {
      throw malformedResponse('LSP navigation result contained neither a Location nor a LocationLink')
    }
  }
  return locations
}

/** Render one `MarkedString` (string form verbatim; object form as a language-tagged fenced block). */
function renderMarkedString(value: WireMarkedString): string {
  if (typeof value === 'string') return value
  return `\`\`\`${value.language}\n${value.value}\n\`\`\``
}

/**
 * Normalize a `Hover` (or `null`) to the seam's hover. `MarkupContent` uses its `value`; a string
 * `MarkedString` is verbatim; a language-tagged `MarkedString` becomes a fenced code block; an array
 * joins its rendered parts with one blank line. The model-facing tool owns the complete result cap.
 * @param payload - the raw `textDocument/hover` result.
 * @returns the normalized hover, or `null` when there is no content.
 * @throws Error when the payload is a non-null, non-object, or structurally invalid hover.
 */
export function normalizeHover(payload: unknown): LspHover | null {
  if (payload === null) return null
  if (payload === undefined) throw malformedResponse('LSP hover result was missing')
  if (typeof payload !== 'object') throw malformedResponse('LSP hover result was not an object')
  const hover = payload as unknown as WireHover
  const contents = renderHoverContents(hover.contents)
  if (contents === '') return null
  const range = hover.range
  if (range === undefined) return { contents }
  if (!isRange(range)) throw malformedResponse('LSP hover result contained a malformed range')
  return { contents, range: toRange(range) }
}

/** Render the three `Hover.contents` encodings into one string (input is untrusted wire data). */
function renderHoverContents(contents: unknown): string {
  if (contents === null || contents === undefined) {
    throw malformedResponse('LSP hover result had no contents')
  }
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) {
    return contents.map((value) => {
      if (isMarkedString(value)) return renderMarkedString(value)
      throw malformedResponse('LSP hover contents contained a malformed MarkedString')
    }).join('\n\n')
  }
  if (typeof contents !== 'object') {
    throw malformedResponse('LSP hover contents were not MarkupContent, MarkedString, or an array')
  }
  const record = contents as Record<string, unknown>
  if (record.kind === 'markdown' || record.kind === 'plaintext') {
    if (typeof record.value !== 'string') {
      throw malformedResponse('LSP hover MarkupContent value was not a string')
    }
    return record.value
  }
  if (typeof record.language === 'string' && typeof record.value === 'string') {
    return renderMarkedString({ language: record.language, value: record.value })
  }
  throw malformedResponse('LSP hover contents were not MarkupContent, MarkedString, or an array')
}

/** Whether an untrusted value is either form of `MarkedString`. */
function isMarkedString(value: unknown): value is WireMarkedString {
  if (typeof value === 'string') return true
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.language === 'string' && typeof record.value === 'string'
}

/** Create the stable structured error used for malformed server result payloads. */
function malformedResponse(message: string): LspError {
  return new LspError(message, 'LSP_MALFORMED_RESPONSE')
}

/**
 * The `textDocument/*` request method that starts each map operation. `callers`/`callees` both start
 * at `prepareCallHierarchy`; the follow-up incoming/outgoing request is the instance's concern.
 * @param operation - the map operation to map.
 * @returns the initial LSP request method name.
 */
export function mapRequestMethod(operation: LspMapOperation): string {
  return operation === 'documentSymbols' ? 'textDocument/documentSymbol' : 'textDocument/prepareCallHierarchy'
}

/**
 * Whether the server advertises the requested map operation.
 * @param capabilities - the server's `initialize` capabilities.
 * @param operation - the map operation to check.
 * @returns true when the corresponding provider capability is present.
 */
export function supportsMapOperation(capabilities: WireServerCapabilities, operation: LspMapOperation): boolean {
  const value = operation === 'documentSymbols' ? capabilities.documentSymbolProvider : capabilities.callHierarchyProvider
  return supportsCapability(value)
}

/** The protocol's numeric `SymbolKind` enum value → seam label. */
const SYMBOL_KIND_LABELS: Readonly<Partial<Record<number, SymbolKindLabel>>> = {
  1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class', 6: 'method',
  7: 'property', 8: 'field', 9: 'constructor', 10: 'enum', 11: 'interface', 12: 'function',
  13: 'variable', 14: 'constant', 15: 'string', 16: 'number', 17: 'boolean', 18: 'array',
  19: 'object', 20: 'key', 21: 'null', 22: 'enumMember', 23: 'struct', 24: 'event',
  25: 'operator', 26: 'typeParameter',
}

/** Resolve a numeric `SymbolKind` to its seam label, rejecting an unknown value. */
function symbolKindLabel(kind: number): SymbolKindLabel {
  const label = SYMBOL_KIND_LABELS[kind]
  if (label === undefined) throw malformedResponse(`unknown SymbolKind "${kind}"`)
  return label
}

/** Whether a symbol carries the `deprecated` marker (boolean field, or `tags` containing `1`). */
function isDeprecated(record: Record<string, unknown>): boolean {
  if (record.deprecated === true) return true
  return Array.isArray(record.tags) && record.tags.includes(1)
}

/**
 * Normalize a `DocumentSymbol[]` (or `null`) into the seam's recursive tree.
 * @param payload - the raw `textDocument/documentSymbol` result.
 * @returns the normalized symbols (empty for `null`).
 * @throws Error when a symbol is structurally invalid.
 */
export function normalizeDocumentSymbols(payload: unknown): LspDocumentSymbol[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP documentSymbol result was missing')
  if (!Array.isArray(payload)) throw malformedResponse('LSP documentSymbol result was not an array')
  return payload.map(normalizeDocumentSymbol)
}

/** Normalize one `DocumentSymbol` (children recurse through {@link normalizeDocumentSymbols}). */
function normalizeDocumentSymbol(value: unknown): LspDocumentSymbol {
  const record = asRecord(value, 'LSP documentSymbol entry')
  const name = record.name
  if (typeof name !== 'string') throw malformedResponse('LSP documentSymbol had no string name')
  const kind = record.kind
  if (typeof kind !== 'number') throw malformedResponse('LSP documentSymbol had an invalid kind')
  const range = record.range
  if (!isRange(range)) throw malformedResponse('LSP documentSymbol had a malformed range')
  const selectionRange = record.selectionRange
  if (!isRange(selectionRange)) throw malformedResponse('LSP documentSymbol had a malformed selectionRange')
  return {
    name,
    kind: symbolKindLabel(kind),
    ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
    ...(isDeprecated(record) ? { deprecated: true } : {}),
    range: toRange(range),
    selectionRange: toRange(selectionRange),
    children: record.children === undefined ? [] : normalizeDocumentSymbols(record.children),
  }
}

/**
 * Normalize a `prepareCallHierarchy` result (`CallHierarchyItem[]` or `null`).
 * @param payload - the raw result.
 * @returns the normalized items (empty for `null`).
 */
export function normalizeCallHierarchyItems(payload: unknown): LspSymbol[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP prepareCallHierarchy result was missing')
  const elements = Array.isArray(payload) ? payload : [payload]
  return elements.map(normalizeCallItem)
}

/** Normalize one `CallHierarchyItem` (a symbol plus its document URI). */
function normalizeCallItem(value: unknown): LspSymbol {
  const record = asRecord(value, 'LSP call-hierarchy item')
  const name = record.name
  if (typeof name !== 'string') throw malformedResponse('LSP call-hierarchy item had no string name')
  const kind = record.kind
  if (typeof kind !== 'number') throw malformedResponse('LSP call-hierarchy item had an invalid kind')
  const uri = record.uri
  if (typeof uri !== 'string') throw malformedResponse('LSP call-hierarchy item had no string uri')
  const range = record.range
  if (!isRange(range)) throw malformedResponse('LSP call-hierarchy item had a malformed range')
  const selectionRange = record.selectionRange
  if (!isRange(selectionRange)) throw malformedResponse('LSP call-hierarchy item had a malformed selectionRange')
  return {
    name,
    kind: symbolKindLabel(kind),
    ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
    ...(isDeprecated(record) ? { deprecated: true } : {}),
    uri,
    range: toRange(range),
    selectionRange: toRange(selectionRange),
  }
}

/**
 * Normalize `CallHierarchyIncomingCall[]` into edges from each caller into `root`.
 * @param root - the prepared symbol every edge points at.
 * @param payload - the raw `callHierarchy/incomingCalls` result.
 * @returns the normalized edges (empty for `null`).
 */
export function normalizeIncomingCalls(root: LspSymbol, payload: unknown): LspCallEdge[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP incomingCalls result was missing')
  if (!Array.isArray(payload)) throw malformedResponse('LSP incomingCalls result was not an array')
  return payload.map((value) => {
    const record = asRecord(value, 'LSP incomingCalls entry')
    return { from: normalizeCallItem(record.from), to: root, sites: normalizeRanges(record.fromRanges) }
  })
}

/**
 * Normalize `CallHierarchyOutgoingCall[]` into edges from `root` into each callee.
 * @param root - the prepared symbol every edge starts at.
 * @param payload - the raw `callHierarchy/outgoingCalls` result.
 * @returns the normalized edges (empty for `null`).
 */
export function normalizeOutgoingCalls(root: LspSymbol, payload: unknown): LspCallEdge[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP outgoingCalls result was missing')
  if (!Array.isArray(payload)) throw malformedResponse('LSP outgoingCalls result was not an array')
  return payload.map((value) => {
    const record = asRecord(value, 'LSP outgoingCalls entry')
    return { from: root, to: normalizeCallItem(record.to), sites: normalizeRanges(record.fromRanges) }
  })
}

/** Validate + convert a `fromRanges` array into seam ranges. */
function normalizeRanges(value: unknown): LspRange[] {
  if (!Array.isArray(value)) throw malformedResponse('LSP call-hierarchy entry had no fromRanges array')
  return value.map((range) => {
    if (!isRange(range)) throw malformedResponse('LSP call-hierarchy entry contained a malformed fromRanges entry')
    return toRange(range)
  })
}

/** Coerce an untrusted element to a record, or throw the stable malformed error. */
function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object') throw malformedResponse(`${label} was not an object`)
  return value as Record<string, unknown>
}
