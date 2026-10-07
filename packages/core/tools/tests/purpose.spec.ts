/** Covers the reserved harness-meta purpose field: squat rejection, injection, and strip. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  PURPOSE_KEY,
  RESERVED_PREFIX,
  assertNoReservedSquat,
  derivePurpose,
  withPurpose,
  type ToolDefinition,
  type ToolDispatchExecution,
  type ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'

const OBJECT_ROOT: Record<string, unknown> = {
  type: 'object',
  properties: { path: { type: 'string' } },
  required: ['path'],
}

/** Read-back view of one exposed schema projection. */
interface ExposedView {
  properties?: Record<string, { type?: string; description?: string }>
  required?: string[]
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  return ctx
}

function fixture(name: string, parameters: Record<string, unknown>): ToolDefinition {
  return {
    name,
    description: `fixture ${name}`,
    parameters,
    output: {
      schema: { type: 'object', properties: { seen: { type: 'array', items: { type: 'string' } } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async args => ({ seen: Object.keys(args as Record<string, unknown>) }),
  }
}

describe('reserved namespace', () => {
  it('reserves only the closed harness prefix', () => {
    expect(PURPOSE_KEY.startsWith(RESERVED_PREFIX)).toBe(true)
    expect(PURPOSE_KEY).toBe('_dsh_harness_purpose')
  })

  it('flags reserved keys and passes domain keys', () => {
    expect(() => assertNoReservedSquat(OBJECT_ROOT, 'clean')).not.toThrow()
    expect(() => assertNoReservedSquat({
      type: 'object',
      properties: { [PURPOSE_KEY]: { type: 'string' } },
    }, 'squatter')).toThrow(/reserved harness-meta key/)
    expect(() => assertNoReservedSquat({
      type: 'object',
      properties: { _dsh_harness_future: { type: 'string' } },
    }, 'squatter')).toThrow('reserved harness-meta key')
  })

  it('passes annotated and non-object roots', () => {
    expect(() => assertNoReservedSquat({ description: 'any json' }, 'open')).not.toThrow()
    expect(() => assertNoReservedSquat({ type: 'array', items: OBJECT_ROOT }, 'list')).not.toThrow()
  })
})

describe('withPurpose', () => {
  it('appends the field last to properties and required', () => {
    const exposed = withPurpose(OBJECT_ROOT) as ExposedView
    expect(Object.keys(exposed.properties ?? {})).toEqual(['path', PURPOSE_KEY])
    expect(exposed.required).toEqual(['path', PURPOSE_KEY])
    expect(exposed.properties?.[PURPOSE_KEY]?.type).toBe('string')
    expect(exposed.properties?.[PURPOSE_KEY]?.description).toContain('human reviewing')
  })

  it('keeps declared order and passes non-object roots through', () => {
    const wide: Record<string, unknown> = { type: 'object', properties: { b: { type: 'string' }, a: { type: 'string' } } }
    expect(Object.keys((withPurpose(wide) as ExposedView).properties ?? {})).toEqual(['b', 'a', PURPOSE_KEY])
    const anyJson: Record<string, unknown> = { description: 'any json' }
    expect(withPurpose(anyJson)).toBe(anyJson)
  })

  it('re-trips the squat check, making injection idempotent', () => {
    expect(() => assertNoReservedSquat(withPurpose(OBJECT_ROOT), 'twice')).toThrow('reserved harness-meta key')
  })
})

describe('derivePurpose', () => {
  it('lifts and strips a present purpose without rewriting other keys', () => {
    const { clean, purpose } = derivePurpose({ path: '/x', [PURPOSE_KEY]: 'fix the build' })
    expect(purpose).toBe('fix the build')
    expect(clean).toEqual({ path: '/x' })
  })

  it('derives nothing from absent, empty, non-string, or non-record blocks', () => {
    expect(derivePurpose({ path: '/x' })).toEqual({ clean: { path: '/x' }, purpose: null })
    expect(derivePurpose({ [PURPOSE_KEY]: '' })).toEqual({ clean: { [PURPOSE_KEY]: '' }, purpose: null })
    expect(derivePurpose({ [PURPOSE_KEY]: 3 })).toEqual({ clean: { [PURPOSE_KEY]: 3 }, purpose: null })
    expect(derivePurpose('not json')).toEqual({ clean: 'not json', purpose: null })
    expect(derivePurpose([1])).toEqual({ clean: [1], purpose: null })
  })
})

const testToolSignal = new AbortController().signal

describe('registry integration', () => {
  it('rejects registrations squatting the reserved namespace', async () => {
    const ctx = await setup()
    expect(() => ctx.tools.register(fixture('squatter', {
      type: 'object',
      properties: { [PURPOSE_KEY]: { type: 'string' } },
    }))).toThrow('reserved harness-meta key')
  })

  it('exposes the field on every model-facing schema, appended last', async () => {
    const ctx = await setup()
    ctx.tools.register(fixture('writer', OBJECT_ROOT))
    const writer = ctx.tools.schemas().find(schema => schema.name === 'writer')
    expect(Object.keys(writer?.parameters.properties ?? {})).toEqual(['path', PURPOSE_KEY])
    expect(writer?.parameters.required).toEqual(['path', PURPOSE_KEY])
  })

  it('strips the field before bodies and lifts it onto the execution', async () => {
    const ctx = await setup()
    ctx.tools.register(fixture('writer', OBJECT_ROOT))
    const seen: Array<{ keys: string[]; purpose?: string | undefined }> = []
    ctx.on('tools/execute', (exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>) => {
      seen.push({ keys: Object.keys(exec.arguments as object), purpose: exec.purpose })
      return next()
    })
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: ToolCallId('c1'),
      name: 'writer',
      arguments: { path: '/x', [PURPOSE_KEY]: 'repair the test' },
    })
    expect(result.isError).not.toBe(true)
    expect(seen).toEqual([{ keys: ['path'], purpose: 'repair the test' }])
  })
})
