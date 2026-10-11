import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

const streamSimple = vi.hoisted(() => vi.fn())

// A hand-declared route is built by `createProvider` over the protocol table in
// `src/provider.ts`, so the table's lazy api module is the SDK boundary this
// test can observe. A catalog route dispatches through pi-ai's own provider and
// would not see this mock.
vi.mock('@earendil-works/pi-ai/api/openai-completions.lazy', () => ({
  openAICompletionsApi: () => ({ stream: streamSimple, streamSimple }),
}))

import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

afterEach(() => { streamSimple.mockReset() })

/** A hand-declared OpenAI-compatible route with one fully described model. */
function gatewayAdapter(): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles({
      'local-gateway': {
        api: 'openai-completions',
        baseURL: 'http://127.0.0.1:9/v1',
        models: [{ id: 'local-model', contextWindow: 8192, maxTokens: 1024 }],
      },
    }),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
  })
}

async function drain(adapter: PiAiAdapter): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream({
    provider: 'local-gateway',
    model: 'local-model',
    messages: [],
  })) chunks.push(chunk)
  return chunks
}

describe('pi-ai SDK retry boundary', () => {
  it('pins one SDK attempt even when the installed provider currently defaults to zero retries', async () => {
    streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })

    const chunks = await drain(gatewayAdapter())

    expect(streamSimple).toHaveBeenCalledOnce()
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ maxRetries: 0, apiKey: 'test-key' })
    // pi-ai reports a setup failure as a terminal in-stream error rather than
    // throwing, which the converter turns into the harness error finish.
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { message: 'mock SDK boundary' } },
    })
  })

  it('dispatches a hand-declared route to the endpoint and model its configuration describes', async () => {
    streamSimple.mockImplementation(() => { throw new Error('mock SDK boundary') })

    await drain(gatewayAdapter())

    expect(streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: 'local-model',
      provider: 'local-gateway',
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:9/v1',
      contextWindow: 8192,
      maxTokens: 1024,
    })
  })
})

describe('grammar constraint forwarding', () => {
  /** The options argument the adapter handed to the SDK for one request. */
  async function observedOptions(extra: Partial<GenerateOptions>): Promise<Record<string, unknown>> {
    streamSimple.mockImplementation(() => { throw new Error('options probe') })
    const chunks: StreamChunk[] = []
    for await (const chunk of gatewayAdapter().stream({
      provider: 'local-gateway',
      model: 'local-model',
      messages: [],
      ...extra,
    })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish' })
    return streamSimple.mock.calls.at(-1)?.[2] as Record<string, unknown>
  }

  it('declares both grammar capabilities so the runtime forwards the fields', () => {
    const adapter = gatewayAdapter()
    expect(adapter.structuredOutputOnRequest).toBe(true)
    expect(adapter.toolChoiceOnRequest).toBe(true)
  })

  it('maps structuredOutput to a strict json_schema response_format via the verbatim body seam', async () => {
    const options = await observedOptions({
      structuredOutput: { type: 'object', properties: {}, additionalProperties: false, strict: true },
    })

    expect(options.samplingParams).toEqual({
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'structured_output',
          strict: true,
          schema: { type: 'object', properties: {}, additionalProperties: false },
        },
      },
    })
  })

  it('defaults strict to false and strips the hint from the schema it gates', async () => {
    const options = await observedOptions({
      structuredOutput: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
    })

    expect(options.samplingParams).toEqual({
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'structured_output',
          strict: false,
          schema: { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] },
        },
      },
    })
  })

  it('forwards scalar toolChoice through pi-ai and pinned calls through the body seam', async () => {
    const required = await observedOptions({ toolChoice: 'required' })
    expect(required.toolChoice).toBe('required')
    expect(required.samplingParams).toBeUndefined()

    const pinned = await observedOptions({ toolChoice: { name: 'quiet_finish' } })
    expect(pinned.toolChoice).toBeUndefined()
    expect(pinned.samplingParams).toEqual({
      tool_choice: { type: 'function', function: { name: 'quiet_finish' } },
    })
  })

  it('sends no grammar options when the request carries none', async () => {
    const options = await observedOptions({})
    expect(options.samplingParams).toBeUndefined()
    expect(options.toolChoice).toBeUndefined()
  })
})
