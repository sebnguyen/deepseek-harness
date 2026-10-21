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
import { agentEvents, RequestGrammarService, type Agent } from '@deepseek-ai/dsh-agent'
import { apply, Config, turnShapeProjectionDefinition } from '../src/index.ts'
import type { TurnShape } from '../src/types.ts'

const SIGNAL = new AbortController().signal

function createAgent(name: string, steered?: UserMessage[], queued?: UserMessage[]): Agent {
  return {
    id: SessionId(name),
    session: Session.create(SessionId(name)),
    steer: (message: UserMessage) => {
      steered?.push(message)
    },
    inbox: {
      append: (_target: unknown, message: UserMessage) => {
        queued?.push(message)
      },
    },
  } as unknown as Agent
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

/** Harness mounted with the llm service so grammar capability can be queried. */
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

async function preStep(ctx: Context, agent: Agent, turn: number, step: number, offered: UserMessage[] = offeredMessages()) {
  const messages = offered
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
    // An unchanged shape keeps the same state reference (zero downstream work).
    expect(turnShapeProjectionDefinition.apply(quiet, { type: 'turn-shape/mode', data: { shape: 'quiet' } } as never)).toBe(quiet)
    expect(turnShapeProjectionDefinition.wire?.view({ shape: 'quiet' })).toEqual({ shape: 'quiet' })
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

  it('quiet shape: one per-turn reminder, no grammar fields', async () => {
    const { ctx } = await grammarHarness(true)
    const agent = createAgent('cm-quiet')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    const decision = await preStep(ctx, agent, 1, 1)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(2)
    const reminder = decision.messages.at(-1)
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
    })
  })

  it('quiet on a capability-negative route: reminder yes, no grammar fields', async () => {
    const { ctx } = await grammarHarness(false)
    const queued: UserMessage[] = []
    const agent = createAgent('cm-uncapable', undefined, queued)
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    const decision = await preStep(ctx, agent, 1, 1)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(2)

    expect(await foldedRequest(ctx, agent, 1, 1)).toEqual({ provider: 'test-route', model: 'test-model' })

    // No wrap-up latch anymore: nothing is queued at turn-stopping.
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal: SIGNAL })
    expect(queued).toHaveLength(0)
  })

  it('quiet without the llm service: reminder yes, no grammar fields', async () => {
    const { ctx } = await harness()
    const agent = createAgent('cm-no-llm')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    await preStep(ctx, agent, 1, 1)
    expect(await foldedRequest(ctx, agent, 1, 1)).toEqual({ provider: 'test-route', model: 'test-model' })
  })

  it('quiet turn-stopping queues nothing', async () => {
    const { ctx } = await grammarHarness(true)
    const queued: UserMessage[] = []
    const agent = createAgent('cm-quiet-stop', undefined, queued)
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    await preStep(ctx, agent, 1, 1)
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal: SIGNAL })
    expect(queued).toHaveLength(0)
  })

  it('narrate turns close without any latch either', async () => {
    const { ctx } = await grammarHarness(true)
    const steered: UserMessage[] = []
    const queued: UserMessage[] = []
    const agent = createAgent('cm-narrate-stop', steered, queued)

    await preStep(ctx, agent, 1, 1)
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal: SIGNAL })
    expect(steered).toHaveLength(0)
    expect(queued).toHaveLength(0)
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

  it('a mid-turn selection applies at the next step boundary', async () => {
    const { ctx } = await grammarHarness(true)
    const agent = createAgent('cm-midturn')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    // Step 1 opens under quiet: one epoch reminder, no grammar fields.
    const first = await preStep(ctx, agent, 1, 1)
    if (first.kind !== 'enter') throw new Error('expected an enter decision')
    expect(first.messages).toHaveLength(2)
    expect(await foldedRequest(ctx, agent, 1, 1)).toEqual({ provider: 'test-route', model: 'test-model' })

    // A same-step re-admission shares the step's epoch: nothing injects twice.
    const retried = await preStep(ctx, agent, 1, 1)
    if (retried.kind !== 'enter') throw new Error('expected an enter decision')
    expect(retried.messages).toHaveLength(1)

    // A mid-turn pick commits to the log and resolves at the next step
    // boundary: step 2 runs narrate — the epoch erases, no hint on its fold.
    agent.session.append('turn-shape/mode', { shape: 'narrate' })
    const narrateStep = await preStep(ctx, agent, 1, 2)
    if (narrateStep.kind !== 'enter') throw new Error('expected an enter decision')
    expect(narrateStep.messages).toHaveLength(1)
    expect(await foldedRequest(ctx, agent, 1, 2)).toEqual({ provider: 'test-route', model: 'test-model' })

    // Re-entering quiet re-mints a shaped epoch: the reminder re-notifies at
    // step 3's admission.
    agent.session.append('turn-shape/mode', { shape: 'quiet' })
    const quietStep = await preStep(ctx, agent, 1, 3)
    if (quietStep.kind !== 'enter') throw new Error('expected an enter decision')
    expect(quietStep.messages).toHaveLength(2)
    expect(await foldedRequest(ctx, agent, 1, 3)).toEqual({ provider: 'test-route', model: 'test-model' })
  })

  it('a quiet turn flipped to narrate mid-turn closes without any latch', async () => {
    const { ctx } = await grammarHarness(true)
    const steered: UserMessage[] = []
    const queued: UserMessage[] = []
    const agent = createAgent('cm-rescue', steered, queued)
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    await preStep(ctx, agent, 1, 1)

    agent.session.append('turn-shape/mode', { shape: 'narrate' })
    await agentEvents(ctx, agent).serial('agent/turn-stopping', { turn: 1, signal: SIGNAL })
    expect(steered).toHaveLength(0)
    expect(queued).toHaveLength(0)
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
      input: { hint: '<narrate|quiet>' },
    }])

    const signal = new AbortController().signal
    const quiet = await ctx.commands.execute(agent, '/turn-shape quiet', [], signal)
    expect(quiet?.result).toEqual({ kind: 'success', text: 'Turn shape set to quiet — applies from the next turn.' })
    expect(ctx.sessionProjections.stateOf(agent.session, 'turnShape')).toEqual({ shape: 'quiet' })

    const repeat = await ctx.commands.execute(agent, '/turn-shape quiet', [], signal)
    expect(repeat?.result).toEqual({ kind: 'success', text: 'Turn shape is already quiet.' })

    const invalid = await ctx.commands.execute(agent, '/turn-shape loud', [], signal)
    expect(invalid?.result).toEqual({ kind: 'error', text: 'Usage: /turn-shape <narrate|quiet>.' })
  })

  it('a command-armed shape reaches the next turn\'s reminder', async () => {
    const { ctx } = await harness()
    await ctx.plugin(CommandRuntime)
    await settle()
    const agent = createAgent('cm-command-turn')
    await ctx.commands.execute(agent, '/turn-shape quiet', [], new AbortController().signal)

    const decision = await preStep(ctx, agent, 1, 1)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(2)
    const quietSource = decision.messages.at(-1)?.source as { kind: string; turnShape?: TurnShape } | undefined
    if (quietSource?.kind !== 'turn-shape' || quietSource.turnShape !== 'quiet') {
      throw new Error('expected a turn-shape quiet reminder source')
    }
  })
})
