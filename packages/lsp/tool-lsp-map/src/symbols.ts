/**
 * The `symbols` batch tool over `ctx.lsp`: pipe a `glob` result in, get the condensed per-file
 * symbol layout out. One `documentSymbols` map query per file; the recursive outline flattens
 * depth-first to one line per map-worthy symbol (abbreviations pinned in {@link KIND_ABBREV});
 * optional `hotspots` adds one-hop `in:`/`out:` counts (two extra map queries per kept symbol). Caps
 * cascade `filesPerBatch` → `symbolsPerFile` → `maxResultChars`, each with an explicit omission marker.
 * @module @deepseek-ai/dsh-tool-lsp-map/symbols
 */

import type { Context } from '@deepseek-ai/cordis'
import { LspError } from '@deepseek-ai/dsh-lsp'
import type { LspDocumentSymbol, LspMapOperation, LspPosition, SymbolKindLabel } from '@deepseek-ai/dsh-lsp'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { KIND_ABBREV } from './kind.ts'
import { sessionCwd } from './session-cwd.ts'

/** Resolved caps for the `symbols` tool (plugin config after defaulting). */
export interface SymbolsCaps {
  readonly filesPerBatch: number
  readonly symbolsPerFile: number
  readonly maxResultChars: number
  readonly hotspots: boolean
  readonly timeoutMs: number
}

/** The symbol-line fields (mutable, matching the output schema's `InferValue`). */
export interface SymbolLineView {
  name: string
  kind: string
  line: number
  callers?: number
  callees?: number
}

/** The file-outline fields (mutable, matching the output schema's `InferValue`). */
export interface FileOutlineView {
  path: string
  symbols: SymbolLineView[]
  omittedSymbols: number
}

/** A flattened, kept symbol (map-worthy, zero-based cursor). */
interface FlatSymbol {
  readonly name: string
  readonly kind: SymbolKindLabel
  readonly position: LspPosition
}

const SYMBOL_LINE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    line: { type: 'integer', required: true },
    callers: { type: 'integer' },
    callees: { type: 'integer' },
  },
} as const

const FILE_OUTLINE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    symbols: { type: 'array', required: true, items: SYMBOL_LINE_OUTPUT_SCHEMA },
    omittedSymbols: { type: 'integer', required: true },
  },
} as const

/**
 * Render the condensed symbol layout — the pinned model-facing format. One line per file:
 * `path: [ :line (abbrev) name in:n out:m ; … ]`. `in:`/`out:` appear only when counts are present; a
 * `… +N more symbols` marker closes a truncated file; a trailing line counts omitted files; the whole
 * result is bounded by `maxResultChars`.
 * @param files - the batched outlines.
 * @param omittedFiles - files dropped past `filesPerBatch`.
 * @param maxResultChars - the complete rendered-text cap.
 * @returns the rendered text.
 */
export function formatLayout(files: FileOutlineView[], omittedFiles: number, maxResultChars: number): string {
  const lines: string[] = []
  for (const file of files) {
    const entries = file.symbols.map((symbol) => {
      const counts = symbol.callers === undefined ? '' : ` in:${symbol.callers} out:${symbol.callees}`
      return ` :${symbol.line} (${symbol.kind}) ${symbol.name}${counts}`
    })
    const tail = file.omittedSymbols > 0 ? ` … +${file.omittedSymbols} more symbols` : ''
    lines.push(`${file.path}: [${entries.join(' ;')}${tail} ]`)
  }
  if (omittedFiles > 0) lines.push(`… +${omittedFiles} more files omitted (limit filesPerBatch).`)
  return boundText(lines.join('\n'), maxResultChars)
}

/** Bound the complete rendered text, including the truncation notice itself. */
function boundText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const notice = `\n… layout truncated (limit ${maxChars} characters).`
  if (notice.length >= maxChars) return notice.slice(0, maxChars)
  return `${text.slice(0, maxChars - notice.length)}${notice}`
}

/** Flatten a document-symbol tree depth-first, keeping only map-worthy kinds. */
function flattenSymbols(symbols: readonly LspDocumentSymbol[]): FlatSymbol[] {
  const out: FlatSymbol[] = []
  const walk = (list: readonly LspDocumentSymbol[]): void => {
    for (const symbol of list) {
      if (KIND_ABBREV[symbol.kind] !== undefined) {
        out.push({ name: symbol.name, kind: symbol.kind, position: symbol.selectionRange.start })
      }
      walk(symbol.children)
    }
  }
  walk(symbols)
  return out
}

/** Count one hop of `callers`/`callees` edges for a symbol at `position`, or 0 on a null root. */
async function countCalls(
  ctx: Context,
  workspaceRoot: string,
  filePath: string,
  position: LspPosition,
  operation: LspMapOperation,
  signal: AbortSignal | undefined,
): Promise<number> {
  const result = await ctx.lsp.mapQuery({ operation, filePath, position, workspaceRoot }, signal)
  return result.kind === 'callEdges' ? result.edges.length : 0
}

/**
 * Register the `symbols` tool.
 * @param ctx - plugin context (must inject `tools`, `lsp`).
 * @param caps - resolved caps.
 */
export function applySymbolsTool(ctx: Context, caps: SymbolsCaps): void {
  ctx.tools.register(defineTool({
    name: 'symbols',
    description: 'Map a batch of source files to a condensed symbol layout. Pipe a `glob` result into `files` to see each file as `path: [ :line (abbrev) name in:n out:m ; … ]`; `in:` = incoming callers, `out:` = outgoing callees (present only with hotspots). Use `lsp` callers/callees on a chosen symbol for the precise call sites.',
    parameters: {
      files: {
        type: 'array',
        required: true,
        items: { type: 'string' },
        description: 'Source file paths to outline — the paths a `glob` returned.',
      },
      hotspots: {
        type: 'boolean',
        description: 'Also run call hierarchy per symbol to append in:/out: caller/callee counts (2 extra map queries per symbol).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          files: { type: 'array', required: true, items: FILE_OUTLINE_OUTPUT_SCHEMA },
          omittedFiles: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatLayout(value.files, value.omittedFiles, caps.maxResultChars) }],
    },
    timeoutMs: caps.timeoutMs,
    async execute(args, exec) {
      const workspaceRoot = sessionCwd(exec)
      if (workspaceRoot === undefined) {
        throw new LspError('the symbols tool requires a session workspace cwd', 'LSP_WORKSPACE_REQUIRED')
      }
      const hotspots = args.hotspots === true || caps.hotspots
      const boundedFiles = args.files.slice(0, caps.filesPerBatch)
      const omittedFiles = args.files.length - boundedFiles.length
      const files: FileOutlineView[] = []
      for (const filePath of boundedFiles) {
        const result = await ctx.lsp.mapQuery({ operation: 'documentSymbols', filePath, workspaceRoot }, exec.signal)
        /* v8 ignore next -- documentSymbols always normalizes to symbolTree. */
        if (result.kind !== 'symbolTree') throw new Error(`lsp mapQuery returned ${result.kind} for documentSymbols`)
        const kept = flattenSymbols(result.symbols)
        const flat = kept.slice(0, caps.symbolsPerFile)
        const symbols: SymbolLineView[] = []
        for (const symbol of flat) {
          const line = symbol.position.line + 1
          if (hotspots) {
            const callers = await countCalls(ctx, workspaceRoot, filePath, symbol.position, 'callers', exec.signal)
            const callees = await countCalls(ctx, workspaceRoot, filePath, symbol.position, 'callees', exec.signal)
            symbols.push({ name: symbol.name, kind: symbol.kind, line, callers, callees })
          } else {
            symbols.push({ name: symbol.name, kind: symbol.kind, line })
          }
        }
        files.push({ path: filePath, symbols, omittedSymbols: kept.length - flat.length })
      }
      return { files, omittedFiles }
    },
  }))
}
