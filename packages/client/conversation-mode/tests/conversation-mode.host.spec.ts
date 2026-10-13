import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  createUserMessage,
  LlmAdapter,
  type LlmCallConfig,
  type StreamChunk,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { agentEvents, GRAMMAR_PRIORITY, RequestGrammarService, type Agent } from '@deepseek-ai/dsh-agent'
import { apply, Config, EMPTY_OBJECT_SCHEMA, turnShapeProjectionDefinition } from '../src/index.ts'
import type { TurnShape } from '../src/types.ts'

const SIGNAL = new AbortController().signal

function createAgent(name: string, steered?: UserMessage[]): Agent {
  return {
    id: SessionId(name),
    session: Session.create(SessionId(name)),
    steer: (message: UserMessage) => {
      steered?.push(message)
    },
  } as Agent
}

/** Adapter whose per-route grammar flags answer `capable` for every route. */
class GrammarAdapter extends LlmAdapter {
  constructor(capable: boolean) {
    super()
    if (capable) {
      this.structuredOutputOnRequest = true
      this.toolChoiceOnRequest = true
    }
  }

  async * stream(): AsyncIterable<StreamChunk> {
    // No model traffic is exercised by these specs.
  }
}

/** Settle the inject children's mounts after plugin(apply). */
async function settle() {
  await new Promise(resolve => setImmediate(resolve))
}

async function harness() {
  const ctx = new Context()
  const service = new RequestGrammarService(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin({ apply, Config })
  await settle()
  return { ctx, service }
}

/** Harness mounted with the llm service so the grammar hints can register. */
async function grammarHarness(capable: boolean) {
  const base = await harness()
  await base.ctx.plugin(LlmRuntime)
  base.ctx.llm.registerAdapter(['test-route'], new GrammarAdapter(capable))
  await settle()
  return base
}

function offeredMessages() {
  return [createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })]
}

async function preStep(ctx: Context, agent: Agent, turn: number, step: number) {
  const messages = offeredMessages()
  return agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { turn, step, messages, signal: SIGNAL },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

async function foldedRequest(ctx: Context, agent: Agent, turn: number, step: number): Promise<LlmCallConfig> {
  return agentEvents(ctx, agent).waterfall(
    'agent/request', { turn, step, signal: SIGNAL },
    () => Promise.resolve({ provider: 'test-route', model: 'test-model' }),
  )
}

describe('turnShape projection', () => {
  it('folds the log: narrate without events, last event wins', () => {
    const init = turnShapeProjectionDefinition.init()
    expect(init).toEqual({ shape: 'narrate' })
    expect(turnShapeProjectionDefinition.apply(init, { type: 'request/header', data: {} } as never)).toBe(init)
    const quiet = turnShapeProjectionDefinition.apply(init, { type: 'turn-shape/mode', data: { shape: 'quiet' } } as never)
    expect(quiet).toEqual({ shape: 'quiet' })
    expect(turnShapeProjectionDefinition.apply(quiet, { type: 'turn-shape/mode', data: { shape: 'tools' } } as never))
      .toEqual({ shape: 'tools' })
    // An unchanged shape keeps the same state reference (zero downstream work).
    expect(turnShapeProjectionDefinition.apply(quiet, { type: 'turn-shape/mode', data: { shape: 'quiet' } } as never)).toBe(quiet)
    expect(turnShapeProjectionDefinition.wire?.view({ shape: 'tools' })).toEqual({ shape: 'tools' })
  })

  it('serves folded state per session through the registry the plugin registers', async () => {
    const { ctx } = await harness()
    const agent = createAgent('cm-proj')
    const other = createAgent('cm-proj-other')
    expect(ctx.sessionProjections.stateOf(agent.session, 'turnShape')).toEqual({ shape: 'narrate' })
    agent.session.append('turn-shape/mode', { shape: 'quiet' })
    expect(ctx.sessionProjections.stateOf(agent.session, 'turnShape')).toEqual({ shape: 'quiet' })
    // Session scope: one session's selection never touches another's fold.
    expect(ctx.sessionProjections.stateOf(other.session, 'turnShape')).toEqual({ shape: 'narrate' })
    expect(ctx.sessionProjections.snapshot(agent.session).values.turnShape).toEqual({ shape: 'quiet' })
  })
})

describe('conversation-mode host', () => {
  it('narrate by default: no reminder, no grammar hint even on a capable route', async () => {
    const { ctx } = await grammarHarness(true)
    const agent = createAgent('cm-narrate')

    const decision = await preStep(ctx, agent, 1, 1)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(1)

    const seed: LlmCallConfig = { provider: 'test-route', model: 'test-model' }
    expect(await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL }, () => Promise.resolve({ ...seed }),
    )).toEqual(seed)
  })

  it('quiet shape: one per-turn reminder plus the shield and explicit toolChoice', async () => {
    const { ctx } = await grammarHarness(true)
    const agent = createAgent('cm-quiet')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    const decision = await preStep(ctx, agent, 1, 1)
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
    const second = await preStep(ctx, agent, 1, 2)
    if (second.kind !== 'enter') throw new Error('expected an enter decision')
    expect(second.messages).toHaveLength(1)

    expect(await foldedRequest(ctx, agent, 1, 2)).toEqual({
      provider: 'test-route',
      model: 'test-model',
      toolChoice: 'auto',
      structuredOutput: EMPTY_OBJECT_SCHEMA,
    })
  })

  it('tools shape: summary-free reminder copy and the same grammar hints', async () => {
    const { ctx } = await grammarHarness(true)
    const agent = createAgent('cm-tools')
    agent.session.append('turn-shape/mode', { shape: 'tools' })

    const decision = await preStep(ctx, agent, 1, 1)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    const text = decision.messages.at(-1)?.content
      .map(blockOf => blockOf.type === 'text' ? blockOf.text : '').join('')
    expect(text).toContain('tools')
    expect(text).toContain('without a summary')

    expect(await foldedRequest(ctx, agent, 1, 1)).toEqual({
      provider: 'test-route',
      model: 'test-model',
      toolChoice: 'auto',
      structuredOutput: EMPTY_OBJECT_SCHEMA,
    })
  })

  it('quiet on a capability-negative route: reminder yes, grammar no', async () => {
    const { ctx } = await grammarHarness(false)
    const agent = createAgent('cm-uncapable')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    const decision = await preStep(ctx, agent, 1, 1)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(2)

    expect(await foldedRequest(ctx, agent, 1, 1)).toEqual({ provider: 'test-route', model: 'test-model' })
  })

  it('quiet without the llm service: reminder yes, grammar no', async () => {
    const { ctx } = await harness()
    const agent = createAgent('cm-no-llm')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    await preStep(ctx, agent, 1, 1)
    expect(await foldedRequest(ctx, agent, 1, 1)).toEqual({ provider: 'test-route', model: 'test-model' })
  })

  it('quiet natural stop steers one unshielded wrap-up, then closes for real', async () => {
    const { ctx } = await grammarHarness(true)
    const steered: UserMessage[] = []
    const agent = createAgent('cm-wrapup', steered)
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    await preStep(ctx, agent, 1, 1)
    expect(await foldedRequest(ctx, agent, 1, 1)).toMatchObject({ structuredOutput: EMPTY_OBJECT_SCHEMA })

    // The natural zero-tool-call ending fires exactly one wrap-up cue.
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal: SIGNAL })
    expect(steered).toHaveLength(1)
    const cue = steered[0]?.content.map(blockOf => blockOf.type === 'text' ? blockOf.text : '').join('')
    expect(cue).toContain('plain final answer')

    // The wrap-up step goes out with the restriction removed.
    expect(await foldedRequest(ctx, agent, 1, 2)).toEqual({ provider: 'test-route', model: 'test-model' })

    // A second stop in the same turn closes the turn: no second cue.
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal: SIGNAL })
    expect(steered).toHaveLength(1)

    // The next turn re-mints: grammar returns and the wrap-up may steer again.
    await preStep(ctx, agent, 2, 1)
    expect(await foldedRequest(ctx, agent, 2, 1)).toMatchObject({ structuredOutput: EMPTY_OBJECT_SCHEMA })
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 2, signal: SIGNAL })
    expect(steered).toHaveLength(2)
  })

  it('snapshot bookkeeping stays bounded: an evicted wrap-up may steer anew', async () => {
    const { ctx } = await grammarHarness(true)
    const steered: UserMessage[] = []
    const evicted = createAgent('cm-evict-0', steered)
    evicted.session.append('turn-shape/mode', { shape: 'quiet' })
    await preStep(ctx, evicted, 1, 1)
    await agentEvents(ctx, evicted).serial('agent/turn-stopping', { turn: 1, signal: SIGNAL })
    expect(steered).toHaveLength(1)

    // MAX_SNAPSHOTS is 64: the 65th distinct live agent sweeps the oldest.
    for (let i = 1; i <= 64; i += 1) {
      await preStep(ctx, createAgent(`cm-evict-${i}`), 1, 1)
    }

    // The wrap-up memory went out with the snapshot, so the same stop fires
    // the cue again under the re-minted quiet shape.
    await agentEvents(ctx, evicted).serial('agent/turn-stopping', { turn: 1, signal: SIGNAL })
    expect(steered).toHaveLength(2)
  })

  it('tools shape steers nothing: the turn ends when the agent ends it', async () => {
    const { ctx } = await grammarHarness(true)
    const steered: UserMessage[] = []
    const agent = createAgent('cm-tools-stop', steered)
    agent.session.append('turn-shape/mode', { shape: 'tools' })

    await preStep(ctx, agent, 1, 1)
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal: SIGNAL })
    expect(steered).toHaveLength(0)
  })

  it('narrate turns steer nothing on a natural stop', async () => {
    const { ctx } = await grammarHarness(true)
    const steered: UserMessage[] = []
    const agent = createAgent('cm-narrate-stop', steered)

    await preStep(ctx, agent, 1, 1)
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal: SIGNAL })
    expect(steered).toHaveLength(0)
  })

  it('grammar hints can be disabled through config; the reminder stays', async () => {
    const ctx = new Context()
    new RequestGrammarService(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['test-route'], new GrammarAdapter(true))
    await ctx.plugin({ apply, Config }, { grammarHints: false })
    await settle()

    const agent = createAgent('cm-config-off')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })
    const decision = await preStep(ctx, agent, 1, 1)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(2)
    expect(await foldedRequest(ctx, agent, 1, 1)).toEqual({ provider: 'test-route', model: 'test-model' })
  })

  it('a capture driver\'s schema outranks the shield; the toolChoice hint still lands', async () => {
    const { ctx, service } = await grammarHarness(true)
    const agent = createAgent('cm-arbitration')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })
    const childSchema = { type: 'object' as const, properties: { handoff: { type: 'string' as const } }, required: ['handoff'] }

    service.contribute({
      id: 'test-capture',
      priority: GRAMMAR_PRIORITY.structuredOutputDriver,
      attach: ({ agent: draft }) => draft.id === agent.id ? { structuredOutput: childSchema } : undefined,
    })

    await preStep(ctx, agent, 1, 1)
    expect(await foldedRequest(ctx, agent, 1, 2)).toEqual({
      provider: 'test-route',
      model: 'test-model',
      toolChoice: 'auto',
      structuredOutput: childSchema,
    })
  })

  it('scopes the shape per session: one quiet session leaves another narrate', async () => {
    const { ctx } = await harness()
    const quietAgent = createAgent('cm-scope-quiet')
    const stockAgent = createAgent('cm-scope-stock')
    quietAgent.session.append('turn-shape/mode', { shape: 'quiet' })

    const quietDecision = await preStep(ctx, quietAgent, 1, 1)
    if (quietDecision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(quietDecision.messages).toHaveLength(2)

    const stockDecision = await preStep(ctx, stockAgent, 1, 1)
    if (stockDecision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(stockDecision.messages).toHaveLength(1)
  })

  it('snapshots the shape per turn: a mid-turn switch applies from the next turn', async () => {
    const { ctx } = await harness()
    const agent = createAgent('cm-midturn')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    // Turn 1 opens as quiet and stays quiet for its rest.
    const first = await preStep(ctx, agent, 1, 1)
    if (first.kind !== 'enter') throw new Error('expected an enter decision')
    expect(first.messages).toHaveLength(2)

    // A mid-turn selection commits to the log but not the open turn.
    agent.session.append('turn-shape/mode', { shape: 'narrate' })
    const retried = await preStep(ctx, agent, 1, 1)
    if (retried.kind !== 'enter') throw new Error('expected an enter decision')
    expect(retried.messages).toHaveLength(2)

    // Turn 2 opens on the new folded state.
    const second = await preStep(ctx, agent, 2, 1)
    if (second.kind !== 'enter') throw new Error('expected an enter decision')
    expect(second.messages).toHaveLength(1)
  })
})

describe('/turn-shape command', () => {
  it('registers only with a command runtime and appends the selection', async () => {
    const bare = await harness()
    expect(bare.ctx.get('commands')).toBeUndefined()

    const { ctx } = await harness()
    await ctx.plugin(CommandRuntime)
    await settle()
    const agent = createAgent('cm-command')
    expect(ctx.commands.list(agent)).toEqual([{
      definitionId: '@deepseek-ai/dsh-client-conversation-mode',
      name: 'turn-shape',
      description: "Set this session's turn shape",
      input: { hint: '<narrate|quiet|tools>' },
    }])

    const signal = new AbortController().signal
    const quiet = await ctx.commands.execute(agent, '/turn-shape quiet', [], signal)
    expect(quiet?.result).toEqual({ kind: 'success', text: 'Turn shape set to quiet — applies from the next turn.' })
    expect(ctx.sessionProjections.stateOf(agent.session, 'turnShape')).toEqual({ shape: 'quiet' })

    const repeat = await ctx.commands.execute(agent, '/turn-shape quiet', [], signal)
    expect(repeat?.result).toEqual({ kind: 'success', text: 'Turn shape is already quiet.' })

    const invalid = await ctx.commands.execute(agent, '/turn-shape loud', [], signal)
    expect(invalid?.result).toEqual({ kind: 'error', text: 'Usage: /turn-shape <narrate|quiet|tools>.' })
  })

  it('a command-armed shape reaches the next turn\'s reminder', async () => {
    const { ctx } = await harness()
    await ctx.plugin(CommandRuntime)
    await settle()
    const agent = createAgent('cm-command-turn')
    await ctx.commands.execute(agent, '/turn-shape tools', [], new AbortController().signal)

    const decision = await preStep(ctx, agent, 1, 1)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(2)
    const toolsSource = decision.messages.at(-1)?.source as { kind: string; turnShape?: TurnShape } | undefined
    if (toolsSource?.kind !== 'turn-shape' || toolsSource.turnShape !== 'tools') {
      throw new Error('expected a turn-shape tools reminder source')
    }
  })
})
