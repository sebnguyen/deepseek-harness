/**
 * Model-facing `lsp` tool over `ctx.lsp`. One read-only tool with four operations
 * (`goToDefinition`/`findReferences`/`goToImplementation`/`hover`); it converts one-based UTF-16
 * cursor coordinates to the seam's zero-based positions, requires the session workspace with no
 * fallback, caps and renders results, and attaches a configurable timeout budget for
 * `dsh-tool-call-timeout-policy` to enforce. It runtime-injects only `tools`, `lsp`, and `systemPrompt` and
 * imports no provider.
 *
 * Namespace plugin (named exports, no default export).
 * @module @deepseek-ai/dsh-tool-lsp
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { adviceLine } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { LspError, type LspSymbol } from '@deepseek-ai/dsh-lsp'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import {
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  describeLspCoverage,
  formatCallEdges,
  formatHover,
  formatLocations,
  parseLspArgs,
  presentLspCall,
  TOOL_OPERATIONS,
} from './render.ts'
import { sessionCwd } from './session-cwd.ts'

export {
  DEFAULT_MAX_LOCATIONS,
  DEFAULT_MAX_RESULT_CHARS,
  describeLspCoverage,
  formatCallEdges,
  formatHover,
  formatLocations,
  LSP_OPERATIONS,
  parseLspArgs,
  presentLspCall,
  renderUri,
  TOOL_OPERATIONS,
} from './render.ts'
export type { CallEdgeSymbolView, CallEdgeView, ToolOperation } from './render.ts'
export { sessionCwd } from './session-cwd.ts'

/** Cordis plugin name for loader diagnostics. */
export const name = 'tool-lsp'

/** Services required by this plugin. */
export const inject = ['tools', 'lsp', 'systemPrompt']

/** Default tool-call timeout budget (ms), covering the queued open/query/close lifecycle. */
export const DEFAULT_LSP_TOOL_TIMEOUT_MS = 60_000

/** The stable system-prompt guidance positioning LSP as a precision aid. */
export const LSP_PROMPT_TEXT =
  adviceLine('Lsp resolves definitions, references, callers, and callees from the language server, so it disambiguates a symbol name that grep cannot. Example: lsp find references on createUser before renaming.')
  + ' Positions are one-based line and character (UTF-16) at the cursor; an off-symbol position may return no results. findReferences always includes the declaration. Use callers/callees for one hop of precise call sites.'

/** Plugin configuration: result caps and the timeout budget. */
export interface Config {
  /** Largest number of rendered locations before an omission marker (default 100). */
  maxLocations?: number
  /** Largest complete rendered result in characters, including truncation metadata (default 16000). */
  maxResultChars?: number
  /** Tool-call timeout budget in ms (default 60000). */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  maxLocations: z.number().default(DEFAULT_MAX_LOCATIONS),
  maxResultChars: z.number().default(DEFAULT_MAX_RESULT_CHARS),
  timeoutMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_LSP_TOOL_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

const LSP_POSITION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    line: { type: 'integer', required: true },
    character: { type: 'integer', required: true },
  },
} as const

const LSP_RANGE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    start: { ...LSP_POSITION_OUTPUT_SCHEMA, required: true },
    end: { ...LSP_POSITION_OUTPUT_SCHEMA, required: true },
  },
} as const

const LSP_SYMBOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    detail: { type: 'string' },
    deprecated: { type: 'boolean' },
    uri: { type: 'string', required: true },
    range: { ...LSP_RANGE_OUTPUT_SCHEMA, required: true },
    selectionRange: { ...LSP_RANGE_OUTPUT_SCHEMA, required: true },
  },
} as const

const LSP_CALL_EDGE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { ...LSP_SYMBOL_OUTPUT_SCHEMA, required: true },
    to: { ...LSP_SYMBOL_OUTPUT_SCHEMA, required: true },
    sites: { type: 'array', required: true, items: LSP_RANGE_OUTPUT_SCHEMA },
  },
} as const

/**
 * Register the `lsp` tool and its system-prompt guidance.
 * @param ctx - the plugin context (must inject `tools`, `lsp`, `systemPrompt`).
 * @param config - the resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('maxLocations', resolved.maxLocations)
  assertPositiveInteger('maxResultChars', resolved.maxResultChars)
  assertTimer('timeoutMs', resolved.timeoutMs)

  ctx.systemPrompt.section({
    name: 'tool:lsp',
    order: ctx.systemPrompt.getSectionOrder('TOOL_LSP'),
    text: LSP_PROMPT_TEXT,
  })

  // Appended after the fixed guidance above, never replacing it: which
  // extensions are covered depends on which providers are registered right
  // now, so this section is re-resolved on every assembly instead of being
  // fixed text like TOOL_LSP. Empty (registers nothing) until a provider
  // exists — no false claim of coverage before one does.
  ctx.systemPrompt.section({
    name: 'tool:lsp-coverage',
    order: ctx.systemPrompt.getSectionOrder('TOOL_LSP_COVERAGE'),
    text: () => describeLspCoverage(ctx.lsp.listRoutes()),
  })

  ctx.tools.register(defineTool({
    name: 'lsp',
    description:
      'Query a language server for precise code navigation. operation is one of goToDefinition, findReferences, goToImplementation, hover, callers, callees. line and character are one-based UTF-16 cursor coordinates. findReferences includes the declaration; callers/callees return one hop of precise call sites.',
    parameters: {
      operation: {
        type: 'string',
        required: true,
        enum: [...TOOL_OPERATIONS],
        description: 'goToDefinition, findReferences, goToImplementation, hover, callers, or callees.',
      },
      file_path: { type: 'string', required: true, description: 'The source file to query, relative to the workspace or absolute.' },
      line: { type: 'number', required: true, description: 'One-based line of the cursor.' },
      character: { type: 'number', required: true, description: 'One-based UTF-16 column of the cursor.' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'locations' },
              locations: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    uri: { type: 'string', required: true },
                    range: { ...LSP_RANGE_OUTPUT_SCHEMA, required: true },
                  },
                },
              },
              resolvedWorkspaceUri: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'hover' },
              hover: {
                required: true,
                oneOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      contents: { type: 'string', required: true },
                      range: LSP_RANGE_OUTPUT_SCHEMA,
                    },
                  },
                ],
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'callEdges' },
              root: { required: true, oneOf: [{ type: 'null' }, LSP_SYMBOL_OUTPUT_SCHEMA] },
              edges: { type: 'array', required: true, items: LSP_CALL_EDGE_OUTPUT_SCHEMA },
              resolvedWorkspaceUri: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (args, value) => {
        switch (value.kind) {
          case 'locations':
            return [{ type: 'text', text: formatLocations(value.locations, value.resolvedWorkspaceUri, resolved.maxLocations, resolved.maxResultChars) }]
          case 'hover':
            return [{ type: 'text', text: formatHover(value.hover, resolved.maxResultChars) }]
          case 'callEdges':
            return [{ type: 'text', text: formatCallEdges(value.root, value.edges, args.operation === 'callees' ? 'callees' : 'callers', value.resolvedWorkspaceUri, resolved.maxResultChars) }]
          /* v8 ignore next -- exhaustive over the output schema's closed union; unreachable. */
          default:
            return assertNever(value, 'tool-lsp output')
        }
      },
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const input = parseLspArgs(args)
      const workspaceRoot = sessionCwd(exec)
      if (workspaceRoot === undefined) {
        throw new LspError('the lsp tool requires a session workspace cwd', 'LSP_WORKSPACE_REQUIRED')
      }
      if (input.operation === 'callers' || input.operation === 'callees') {
        const mapResult = await ctx.lsp.mapQuery({
          operation: input.operation,
          filePath: input.filePath,
          position: input.position,
          workspaceRoot,
        }, exec.signal)
        // `callers`/`callees` always normalize to `callEdges`; narrow away the symbolTree arm.
        /* v8 ignore next -- unreachable: the map result for callers/callees is always callEdges. */
        if (mapResult.kind !== 'callEdges') throw new Error(`lsp mapQuery returned ${mapResult.kind} for ${input.operation}`)
        return {
          kind: 'callEdges' as const,
          root: mapResult.root === null ? null : toSymbolOutput(mapResult.root),
          edges: mapResult.edges.map(edge => ({
            from: toSymbolOutput(edge.from),
            to: toSymbolOutput(edge.to),
            sites: edge.sites.map(site => ({
              start: { line: site.start.line, character: site.start.character },
              end: { line: site.end.line, character: site.end.character },
            })),
          })),
          resolvedWorkspaceUri: mapResult.resolvedWorkspaceUri,
        }
      }
      const result = await ctx.lsp.query({
        operation: input.operation,
        filePath: input.filePath,
        position: input.position,
        workspaceRoot,
      }, exec.signal)
      switch (result.kind) {
        case 'locations':
          return {
            kind: 'locations' as const,
            locations: result.locations.map(location => ({
              uri: location.uri,
              range: {
                start: { line: location.range.start.line, character: location.range.start.character },
                end: { line: location.range.end.line, character: location.range.end.character },
              },
            })),
            resolvedWorkspaceUri: result.resolvedWorkspaceUri,
          }
        case 'hover':
          return {
            kind: 'hover' as const,
            hover: result.hover === null
              ? null
              : {
                contents: result.hover.contents,
                ...result.hover.range === undefined
                  ? {}
                  : {
                    range: {
                      start: { line: result.hover.range.start.line, character: result.hover.range.start.character },
                      end: { line: result.hover.range.end.line, character: result.hover.range.end.character },
                    },
                  },
              },
          }
        /* v8 ignore next -- exhaustive over the closed LspQueryResult union; unreachable. */
        default:
          return assertNever(result, 'tool-lsp result')
      }
    },
    presentCall: presentLspCall,
  }))
}

/** Re-shape a seam symbol (`readonly`) into the tool's mutable output-schema symbol. */
function toSymbolOutput(symbol: LspSymbol) {
  return {
    name: symbol.name,
    kind: symbol.kind,
    ...(symbol.detail === undefined ? {} : { detail: symbol.detail }),
    ...(symbol.deprecated === undefined ? {} : { deprecated: symbol.deprecated }),
    uri: symbol.uri,
    range: {
      start: { line: symbol.range.start.line, character: symbol.range.start.character },
      end: { line: symbol.range.end.line, character: symbol.range.end.character },
    },
    selectionRange: {
      start: { line: symbol.selectionRange.start.line, character: symbol.selectionRange.start.character },
      end: { line: symbol.selectionRange.end.line, character: symbol.selectionRange.end.character },
    },
  }
}

/** Reject a non-positive-integer config value at load, so misconfiguration fails loud. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-lsp: ${name} must be a positive integer`)
  }
}

/** Reject a timer value Node would clamp instead of scheduling as configured. */
function assertTimer(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-lsp: ${name} must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
