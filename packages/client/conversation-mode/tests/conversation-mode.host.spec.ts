import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, createUserMessage, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { agentEvents, GRAMMAR_PRIORITY, RequestGrammarService, type Agent } from '@deepseek-ai/dsh-agent'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'
import { apply } from '../src/index.ts'
import { normalizeTurnShape } from '../src/turn-shape-settings.ts'

const SIGNAL = new AbortController().signal
const EMPTY_SCRIPT: [] = []

class StubAdapter extends LlmAdapter {
  override readonly structuredOutputOnRequest: boolean

  constructor(capable: boolean) {
    super()
    this.structuredOutputOnRequest = capable
  }

  async *stream(): AsyncIterableIterator<never> {
    yield* EMPTY_SCRIPT
  }
}

function createAgent(name: string): Agent {
  return { id: SessionId(name), session: Session.create(SessionId(name)) } as Agent
}

/** Settle the settings provider's async first-load before the plugin installs its section. */
async function settle() {
  await Promise.resolve()
  await Promise.resolve()
}

interface BrokenHarnessOptions {
  doc?: Record<string, unknown>
  capable?: boolean
}

async function harness({ doc = {}, capable = true }: BrokenHarnessOptions = {}) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['test-route'], new StubAdapter(capable))
  const service = new RequestGrammarService(ctx)
  // SettingsProvider publishes its document through the Service.init
  // lifecycle, which fires on plugin mount — a bare `new` never loads it.
  const docCopy = structuredClone(doc)
  class DocSettings extends MemorySettings {
    constructor(c: ConstructorParameters<typeof MemorySettings>[0]) {
      super(c, { doc: docCopy })
    }
  }
  await ctx.plugin(DocSettings)
  await settle()
  await ctx.plugin(apply)
  await settle()
  return { ctx, service }
}

describe('normalizeTurnShape', () => {
  it('maps every legacy quiet-mode value onto the shape taxonomy', () => {
    expect(normalizeTurnShape(undefined)).toBe('narrate')
    expect(normalizeTurnShape({})).toBe('narrate')
    expect(normalizeTurnShape({ turnShape: 'quiet' })).toBe('quiet')
    expect(normalizeTurnShape({ turnShape: 'tools' })).toBe('tools')
    expect(normalizeTurnShape({ turnShape: 'narrate' })).toBe('narrate')
    expect(normalizeTurnShape({ turnShape: 'silence' })).toBe('tools')
    expect(normalizeTurnShape({ turnShape: 'normal' })).toBe('narrate')
    expect(normalizeTurnShape({ mode: 'quiet' })).toBe('quiet')
    expect(normalizeTurnShape({ mode: 'silence' })).toBe('tools')
    expect(normalizeTurnShape({ mode: 'normal' })).toBe('narrate')
    expect(normalizeTurnShape({ mode: true })).toBe('quiet')
    expect(normalizeTurnShape({ mode: false })).toBe('narrate')
    // The new field wins over the legacy one.
    expect(normalizeTurnShape({ turnShape: 'tools', mode: 'quiet' })).toBe('tools')
  })
})

describe('conversation-mode host', () => {
  it('narrate by default: no reminder, no grammar mutation', async () => {
    const { ctx } = await harness()
    const agent = createAgent('cm-narrate')
    const offered = [createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })]

    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { turn: 1, step: 1, messages: offered, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter' as const, messages: offered }),
    )
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(1)

    const seed: LlmCallConfig = { provider: 'test-route', model: 'test-model' }
    const seedLiteral = { provider: 'test-route', model: 'test-model' }
    expect(await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL }, () => Promise.resolve(seedLiteral),
    )).toEqual(seed)
  })

  it('quiet shape: one per-turn reminder, no grammar mutation on any route', async () => {
    const doc = { 'ui-quiet': { turnShape: 'quiet' } }
    const capable = await harness({ doc, capable: true })
    const agent = createAgent('cm-quiet')
    const offered = [createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })]

    const decision = await agentEvents(capable.ctx, agent).waterfall(
      'agent/pre-step',
      { turn: 1, step: 1, messages: offered, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter' as const, messages: offered }),
    )
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(2)
    const reminder = decision.messages.at(-1)
    // Client-package module augmentations do not merge into the host
    // aggregate program, so the spec narrows structurally instead.
    const quietSource = reminder?.source as { kind: string; turnShape?: string } | undefined
    if (quietSource?.kind !== 'turn-shape' || quietSource.turnShape !== 'quiet') {
      throw new Error('expected a turn-shape quiet reminder source')
    }
    const reminderText = (reminder?.content ?? []).map(blockOf => blockOf.type === 'text' ? blockOf.text : '').join('')
    expect(reminderText).toContain('[turn-shape]')
    expect(reminderText).toContain('quiet')
    expect(reminderText).toContain('thoughts')

    // Second step of the same turn carries no fresh reminder.
    const second = await agentEvents(capable.ctx, agent).waterfall(
      'agent/pre-step',
      { turn: 1, step: 2, messages: offered, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter' as const, messages: offered }),
    )
    if (second.kind !== 'enter') throw new Error('expected an enter decision')
    expect(second.messages).toHaveLength(1)

    const folded = await agentEvents(capable.ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal: SIGNAL },
      () => Promise.resolve({ provider: 'test-route', model: 'test-model' }),
    )
    // The shape mutates no request grammar: the retired `{}` shield
    // suppressed the provider's reasoning channel with the leaked prose,
    // so quiet must carry no draft fields on any route.
    expect(folded).toEqual({ provider: 'test-route', model: 'test-model' })
    // And never a toolChoice from this plugin.
    expect(Object.keys(folded as object)).not.toContain('toolChoice')

    // Grammar capability no longer gates anything: a capability-negative
    // route sees the same untouched request.
    const incapable = await harness({ doc, capable: false })
    const otherAgent = createAgent('cm-quiet-raw')
    await agentEvents(incapable.ctx, otherAgent).waterfall(
      'agent/pre-step',
      { turn: 1, step: 1, messages: offered, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter' as const, messages: offered }),
    )
    expect(await agentEvents(incapable.ctx, otherAgent).waterfall(
      'agent/request', { turn: 1, step: 2, signal: SIGNAL },
      () => Promise.resolve({ provider: 'test-route', model: 'test-model' }),
    )).toEqual({ provider: 'test-route', model: 'test-model' })
  })

  it('tools shape: summary-free reminder copy, no grammar mutation', async () => {
    const doc = { 'ui-quiet': { turnShape: 'tools' } }
    const { ctx } = await harness({ doc, capable: true })
    const agent = createAgent('cm-tools')
    const offered = [createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })]

    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { turn: 1, step: 1, messages: offered, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter' as const, messages: offered }),
    )
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    const text = decision.messages.at(-1)?.content
      .map(blockOf => blockOf.type === 'text' ? blockOf.text : '').join('')
    expect(text).toContain('tools')
    expect(text).toContain('without a summary')

    expect(await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal: SIGNAL },
      () => Promise.resolve({ provider: 'test-route', model: 'test-model' }),
    )).toEqual({ provider: 'test-route', model: 'test-model' })
  })

  it('legacy silence maps to tools for the reminder', async () => {
    const doc = { 'ui-quiet': { mode: 'silence' } }
    const { ctx } = await harness({ doc, capable: true })
    const agent = createAgent('cm-legacy-silence')
    const offered = [createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })]

    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { turn: 1, step: 1, messages: offered, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter' as const, messages: offered }),
    )
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    const reminder = decision.messages.at(-1)
    const toolsSource = reminder?.source as { kind: string; turnShape?: string } | undefined
    if (toolsSource?.kind !== 'turn-shape' || toolsSource.turnShape !== 'tools') {
      throw new Error('expected a turn-shape tools reminder source')
    }
    expect(await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal: SIGNAL },
      () => Promise.resolve({ provider: 'test-route', model: 'test-model' }),
    )).toEqual({ provider: 'test-route', model: 'test-model' })
  })

  it('snapshots the shape per turn: a mid-turn switch applies from the next turn', async () => {
    const doc = { 'ui-quiet': { turnShape: 'quiet' } }
    const { ctx } = await harness({ doc, capable: true })
    const agent = createAgent('cm-midturn')
    const offered = [createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })]

    // Turn 1 opens as quiet and stays quiet for its rest, even after the
    // settings document flips to narrate mid-turn.
    await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { turn: 1, step: 1, messages: offered, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter' as const, messages: offered }),
    )
    // Flip the stored document to narrate.
    ;(ctx.settings as MemorySettings).pushExternal({ 'ui-quiet': { turnShape: 'narrate' } })
    await settle()

    expect(await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal: SIGNAL },
      () => Promise.resolve({ provider: 'test-route', model: 'test-model' }),
    )).toEqual({ provider: 'test-route', model: 'test-model' })

    // Turn 2 reads the new setting.
    const second = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { turn: 2, step: 1, messages: offered, signal: SIGNAL },
      () => Promise.resolve({ kind: 'enter' as const, messages: offered }),
    )
    if (second.kind !== 'enter') throw new Error('expected an enter decision')
    expect(second.messages).toHaveLength(1)
    expect(await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 2, step: 2, signal: SIGNAL },
      () => Promise.resolve({ provider: 'test-route', model: 'test-model' }),
    )).toEqual({ provider: 'test-route', model: 'test-model' })
  })

  it('a capture driver\'s schema survives a quiet turn: the shape contributes no grammar', async () => {
    const doc = { 'ui-quiet': { turnShape: 'quiet' } }
    const { ctx, service } = await harness({ doc, capable: true })
    const agent = createAgent('cm-arbitration')
    const childSchema = { type: 'object' as const, properties: { handoff: { type: 'string' as const } }, required: ['handoff'] }

    service.contribute({
      id: 'test-capture',
      priority: GRAMMAR_PRIORITY.structuredOutputDriver,
      attach: ({ agent: draft }) => draft.id === agent.id ? { structuredOutput: childSchema } : undefined,
    })

    expect(await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal: SIGNAL },
      () => Promise.resolve({ provider: 'test-route', model: 'test-model' }),
    )).toEqual({ provider: 'test-route', model: 'test-model', structuredOutput: childSchema })
  })
})
