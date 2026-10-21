import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { turnShapeProjectionDefinition } from '@deepseek-ai/dsh-client-conversation-mode'
import { apply } from '../src/index.ts'

function createAgent(name: string): Agent {
  return { id: SessionId(name), session: Session.create(SessionId(name)) } as Agent
}

interface RegisteredTool {
  execute: (args: Record<string, never>, exec: ToolRunContext) => Promise<{ recorded: boolean }>
}

async function harness(registerProjection: boolean) {
  const ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  if (registerProjection) {
    ctx.sessionProjections.register(turnShapeProjectionDefinition)
  }
  const registered = new Map<string, RegisteredTool>()
  ctx.reflect.provide('tools', {
    register(definition: Record<string, unknown>) {
      registered.set(definition.name as string, definition as unknown as RegisteredTool)
    },
  } as never)
  apply(ctx)
  const finish = registered.get('finish')
  if (finish === undefined) throw new Error('finish tool was not registered')
  return { ctx, finish }
}

function execFor(agent: Agent | undefined): { exec: ToolRunContext; concluded: number[] } {
  const concluded: number[] = []
  const exec = {
    agent,
    signal: new AbortController().signal,
    result: undefined,
    deferContext: () => {},
    concludeTurn: () => {
      concluded.push(1)
    },
  } as unknown as ToolRunContext
  return { exec, concluded }
}

describe('finish tool', () => {
  it('registers as `finish` with an empty object schema on inject-order services', async () => {
    const { finish } = await harness(true)
    expect(finish).toBeTypeOf('object')
  })

  it('a quiet call concludes the turn at its result and records', async () => {
    const { finish } = await harness(true)
    const agent = createAgent('tf-quiet')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })

    const { exec, concluded } = execFor(agent)
    await expect(finish.execute({}, exec)).resolves.toEqual({ recorded: true })
    expect(concluded).toHaveLength(1)
  })

  it('a narrate call closes nothing', async () => {
    const { finish } = await harness(true)
    for (const shape of ['narrate'] as const) {
      const agent = createAgent(`tf-${shape}`)
      agent.session.append('turn-shape/mode', { shape })
      const { exec, concluded } = execFor(agent)
      await expect(finish.execute({}, exec)).resolves.toEqual({ recorded: false })
      expect(concluded).toHaveLength(0)
    }
  })

  it('a composition without the turnShape projection records nothing', async () => {
    const { finish } = await harness(false)
    const agent = createAgent('tf-no-projection')
    const { exec, concluded } = execFor(agent)
    await expect(finish.execute({}, exec)).resolves.toEqual({ recorded: false })
    expect(concluded).toHaveLength(0)
  })

  it('a non-agent caller is rejected', async () => {
    const { finish } = await harness(true)
    const { exec } = execFor(undefined)
    await expect(finish.execute({}, exec)).rejects.toThrow('finish requires an owning agent session')
  })

  it('a repeated call in one turn stays recorded', async () => {
    const { finish } = await harness(true)
    const agent = createAgent('tf-twice')
    agent.session.append('turn-shape/mode', { shape: 'quiet' })
    const { exec, concluded } = execFor(agent)
    await finish.execute({}, exec)
    await expect(finish.execute({}, exec)).resolves.toEqual({ recorded: true })
    expect(concluded).toHaveLength(2)
  })
})
