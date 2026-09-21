import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Lsp, { LspProviderId, type LspMapProviderQuery, type LspMapResult, type LspProvider, type LspQueryResult } from '@deepseek-ai/dsh-lsp'
import * as ToolLspMap from '@deepseek-ai/dsh-tool-lsp-map'
import { formatLayout } from '@deepseek-ai/dsh-tool-lsp-map'

const RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }

const tree: LspMapResult = {
  kind: 'symbolTree',
  symbols: [{
    name: 'Lsp', kind: 'class', range: RANGE, selectionRange: { start: { line: 3, character: 0 }, end: { line: 3, character: 3 } },
    children: [
      { name: 'query', kind: 'method', range: RANGE, selectionRange: { start: { line: 4, character: 2 }, end: { line: 4, character: 7 } }, children: [] },
      { name: 'field_x', kind: 'field', range: RANGE, selectionRange: { start: { line: 5, character: 0 }, end: { line: 5, character: 2 } }, children: [] },
    ],
  }],
}

const noEdges: LspMapResult = { kind: 'callEdges', root: null, edges: [], resolvedWorkspaceUri: 'file:///ws' }
const oneCaller: LspMapResult = {
  kind: 'callEdges',
  root: { name: 'query', kind: 'method', uri: 'file:///a.ts', range: RANGE, selectionRange: RANGE },
  edges: [{ from: { name: 'main', kind: 'function', uri: 'file:///b.ts', range: RANGE, selectionRange: RANGE }, to: { name: 'query', kind: 'method', uri: 'file:///a.ts', range: RANGE, selectionRange: RANGE }, sites: [RANGE] }],
  resolvedWorkspaceUri: 'file:///ws',
}

/** A stub provider whose mapQuery answers by operation. */
function mapProvider(respond: (request: LspMapProviderQuery) => LspMapResult): LspProvider {
  return {
    id: LspProviderId('stub'),
    extensionToLanguage: { '.ts': 'typescript' },
    query(): Promise<LspQueryResult> {
      return Promise.resolve({ kind: 'locations', locations: [], resolvedWorkspaceUri: 'file:///ws' })
    },
    mapQuery(request) {
      return Promise.resolve(respond(request))
    },
  }
}

async function mount(respond: (request: LspMapProviderQuery) => LspMapResult, config: ToolLspMap.Config = {}): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Lsp)
  ;(ctx.lsp as Lsp).registerProvider(mapProvider(respond))
  await ctx.plugin(ToolLspMap, config)
  return { ctx }
}

let seq = 0
const signal = new AbortController().signal
function call(ctx: Context, args: unknown, cwd: string | null = '/virtual/ws') {
  return ctx.tools.execute({
    signal,
    callId: `c-${++seq}` as never,
    name: 'symbols',
    arguments: args,
    ...cwd !== null ? { agent: { session: { header: { cwd } } } as never } : {},
  })
}

function textOf(result: { isError: boolean; content?: { type?: string; text?: string }[]; error?: unknown }): string {
  if (result.isError) throw result.error
  return result.content?.find(b => b.type === 'text')?.text ?? ''
}

describe('formatLayout', () => {
  it('renders the pinned path:[ ... ] layout with in/out counts and omission markers', () => {
    const text = formatLayout([{
      path: 'a.ts',
      symbols: [
        { name: 'pick', kind: 'func', line: 14, callers: 1, callees: 0 },
        { name: 'resolve', kind: 'func', line: 31, callers: 4, callees: 3 },
      ],
      omittedSymbols: 3,
    }], 2, 16_000)
    expect(text).toBe('a.ts: [ :14 (func) pick in:1 out:0 ; :31 (func) resolve in:4 out:3 … +3 more symbols ]\n… +2 more files omitted (limit filesPerBatch).')
  })

  it('omits counts when absent and truncates at the byte cap', () => {
    expect(formatLayout([{ path: 'a.ts', symbols: [{ name: 'f', kind: 'func', line: 1 }], omittedSymbols: 0 }], 0, 1000))
      .toBe('a.ts: [ :1 (func) f ]')
  })
})

describe('symbols tool', () => {
  it('outlines each file, skipping collapsed kinds, with a hotspot count', async () => {
    const { ctx } = await mount((request) => {
      if (request.operation === 'documentSymbols') return tree
      return request.operation === 'callers' ? oneCaller : noEdges
    })
    const result = await call(ctx, { files: ['a.ts'], hotspots: true }, '/virtual/ws')
    expect(textOf(result)).toBe('a.ts: [ :4 (class) Lsp in:1 out:0 ; :5 (method) query in:1 out:0 ]')
  })

  it('omits in/out when hotspots is off', async () => {
    const { ctx } = await mount(() => tree)
    const result = await call(ctx, { files: ['a.ts'] }, '/virtual/ws')
    expect(textOf(result)).toBe('a.ts: [ :4 (class) Lsp ; :5 (method) query ]')
  })
})

describe('symbols tool errors', () => {
  it('fails LSP_WORKSPACE_REQUIRED without a session cwd', async () => {
    const { ctx } = await mount(() => tree)
    const result = await call(ctx, { files: ['a.ts'] }, null)
    expect(result.isError).toBe(true)
    expect((result.error as { info?: { code?: string } })?.info?.code).toBe('LSP_WORKSPACE_REQUIRED')
  })
})
