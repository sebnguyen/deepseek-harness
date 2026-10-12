import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type LlmCallConfig } from '@deepseek-ai/dsh-llm'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { agentEvents, GRAMMAR_PRIORITY, RequestGrammarService, type Agent } from '@deepseek-ai/dsh-agent'
import { apply, turnShapeProjectionDefinition } from '../src/index.ts'
import type { TurnShape } from '../src/types.ts'

const SIGNAL = new AbortController().signal

function createAgent(name: string): Agent {
  return { id: SessionId(name), session: Session.create(SessionId(name)) } as Agent
}

/** Settle the inject child's mount after plugin(apply). */
async function settle() {
  await new Promise(resolve => setImmediate(resolve))
}

async function harness() {
  const ctx = new Context()
  const service = new RequestGrammarService(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(apply)
  await settle()
  return { ctx, service }
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
  it('narrate by default: no reminder, no grammar mutation', async () => {
    const { ctx } = await harness()
    const agent = createAgent('cm-narrate')

    const decision = await preStep(ctx, agent, 1, 1)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    expect(decision.messages).toHaveLength(1)

    const seed: LlmCallConfig = { provider: 'test-route', model: 'test-model' }
    expect(await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal: SIGNAL }, () => Promise.resolve({ ...seed }),
    )).toEqual(seed)
  })

  it('quiet shape: one per-turn reminder, no grammar mutation', async () => {
    const { ctx } = await harness()
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

    const folded = await agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 2, signal: SIGNAL },
      () => Promise.resolve({ provider: 'test-route', model: 'test-model' }),
    )
    // The shape mutates no request grammar.
    expect(folded).toEqual({ provider: 'test-route', model: 'test-model' })
    expect(Object.keys(folded as object)).not.toContain('toolChoice')
  })

  it('tools shape: summary-free reminder copy', async () => {
    const { ctx } = await harness()
    const agent = createAgent('cm-tools')
    agent.session.append('turn-shape/mode', { shape: 'tools' })

    const decision = await preStep(ctx, agent, 1, 1)
    if (decision.kind !== 'enter') throw new Error('expected an enter decision')
    const text = decision.messages.at(-1)?.content
      .map(blockOf => blockOf.type === 'text' ? blockOf.text : '').join('')
    expect(text).toContain('tools')
    expect(text).toContain('without a summary')
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

  it('a capture driver\'s schema survives a quiet turn: the shape contributes no grammar', async () => {
    const { ctx, service } = await harness()
    const agent = createAgent('cm-arbitration')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })
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
