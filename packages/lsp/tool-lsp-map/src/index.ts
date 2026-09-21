/**
 * Folder-scale symbol map: a model-facing `symbols` tool over `ctx.lsp` that batches `documentSymbol`
 * outlines per file into a condensed, path-anchored layout. Namespace plugin (named exports, no
 * default export). It runtime-injects only `tools`, `lsp`, and `systemPrompt`, reads sources through
 * the LSP provider, and imports no provider.
 * @module @deepseek-ai/dsh-tool-lsp-map
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { applySymbolsTool, type SymbolsCaps } from './symbols.ts'

export { formatLayout } from './symbols.ts'
export type { FileOutlineView, SymbolLineView, SymbolsCaps } from './symbols.ts'
export { KIND_ABBREV } from './kind.ts'
export { sessionCwd } from './session-cwd.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-lsp-map'

/** Services required by this plugin. */
export const inject = ['tools', 'lsp', 'systemPrompt']

/** Default per-batch cap on files (then omission). */
export const DEFAULT_FILES_PER_BATCH = 100
/** Default per-file cap on kept symbols (then omission). */
export const DEFAULT_SYMBOLS_PER_FILE = 200
/** Default complete rendered-text cap in characters. */
export const DEFAULT_RESULT_CHARS = 16_000
/** Default tool-call timeout budget (ms), covering every file + optional hotspot round-trip. */
export const DEFAULT_TIMEOUT_MS = 120_000

/** Plugin configuration. */
export interface Config {
  /** Max files one `symbols` call outlines inline; later files are omitted. */
  filesPerBatch?: number
  /** Max kept symbols one file contributes; later symbols are omitted. */
  symbolsPerFile?: number
  /** Max complete rendered text in characters, including the truncation marker. */
  maxResultChars?: number
  /** Also run call hierarchy per symbol to append in:/out: counts. */
  hotspots?: boolean
  /** Tool-call timeout budget in ms. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  filesPerBatch: z.number().default(DEFAULT_FILES_PER_BATCH),
  symbolsPerFile: z.number().default(DEFAULT_SYMBOLS_PER_FILE),
  maxResultChars: z.number().default(DEFAULT_RESULT_CHARS),
  hotspots: z.boolean().default(false),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

/** The stable system-prompt guidance for the `symbols` tool, carrying the pinned legend. */
export const SYMBOLS_PROMPT_TEXT =
  'Pipe a `glob` result into `symbols` to map a folder\'s symbol layout before entering read cycles. Each file renders as `path: [ :line (abbrev) name in:n out:m ; … ]`; `in:` = incoming callers, `out:` = outgoing callees (present only with hotspots). Use `lsp` callers/callees on a chosen symbol for one hop of precise call sites; `glob`/`grep` stay the wide orientation layer.'

/**
 * Register the `symbols` tool and its system-prompt guidance.
 * @param ctx - the plugin context (must inject `tools`, `lsp`, `systemPrompt`).
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('filesPerBatch', resolved.filesPerBatch)
  assertPositiveInteger('symbolsPerFile', resolved.symbolsPerFile)
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertTimer('timeoutMs', resolved.timeoutMs)

  ctx.systemPrompt.section({
    name: 'tool:lsp-map',
    order: ctx.systemPrompt.getSectionOrder('TOOL_LSP_MAP'),
    text: SYMBOLS_PROMPT_TEXT,
  })

  const caps: SymbolsCaps = {
    filesPerBatch: resolved.filesPerBatch,
    symbolsPerFile: resolved.symbolsPerFile,
    maxResultChars: resolved.maxResultChars,
    hotspots: resolved.hotspots,
    timeoutMs: resolved.timeoutMs,
  }
  applySymbolsTool(ctx, caps)
}

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-lsp-map: ${name} must be a positive integer`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-lsp-map: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
