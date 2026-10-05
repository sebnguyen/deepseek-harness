/**
 * REAL-composition proof: the shipped YAML shape (session, llm,
 * system-prompt, tools, agent, agent-loop, delegation-cap with config)
 * boots through the vendored Loader, the guard's config validates at load,
 * and a live parent agent sees the (cap+1)-th delegation start denied with
 * the cap reason while cap-many calls pass.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as DelegationCap from '@deepseek-ai/dsh-delegation-cap'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadGuarded(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-delegation-cap-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-loop'",
    '  config:',
    '    agents: []',
    "- name: '@deepseek-ai/dsh-delegation-cap'",
    '  config:',
    '    tools: [explore]',
    '    maxDelegationsPerTurn: 2',
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-delegation-cap', DelegationCap],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads the shipped YAML shape and denies the cap+1 start', async () => {
    const loaded = await loadGuarded()
    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])

    loaded.tools.register(defineContentToolFixture({
      name: 'explore',
      description: 'reader',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'rounds of reading' }] },
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'explore', {}),
      toolCallResponse('c2', 'explore', {}),
      toolCallResponse('c3', 'explore', {}),
    ] as never)
    loaded.llm.registerAdapter(['mock'], adapter)
    const agentLoop = loaded.get('agentLoop') as InstanceType<typeof AgentLoop>
    const parent = await agentLoop.create(SessionId('capped'), { provider: 'mock', model: 'mock' })
    parent.followup({ role: 'user', content: [{ type: 'text', text: 'survey' }], source: { kind: 'user' } } as never)
    await new Promise<void>((resolve) => {
      const dispose = loaded.on('agent/status', ({ agent, status }) => {
        if (agent === parent && status === 'idle') { dispose(); resolve() }
      })
    })
    const results = parent.session.snapshotEvents()
      .filter(event => event.type === 'tool/result') as unknown as { data: { message: { content: { isError?: boolean }[] } } }[]
    expect(results).toHaveLength(3)
    expect(results[0]!.data.message.content[0]?.isError).not.toBe(true)
    expect(results[2]!.data.message.content[0]?.isError).toBe(true)
    expect(JSON.stringify(results[2]!.data.message.content)).toContain('delegation cap reached')
  })

  it('keeps the function-plugin namespace free of a default export', () => {
    expect('default' in DelegationCap).toBe(false)
  })
})
