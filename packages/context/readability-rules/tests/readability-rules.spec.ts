/** Real Loader composition: the rules section registers exactly once with verbatim text. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as systemPromptPlugin from '@deepseek-ai/dsh-system-prompt'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ReadabilityRules from '@deepseek-ai/dsh-readability-rules'
import { PLAIN_ANSWERS_RULES, SECTION_NAME } from '../src/index.ts'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('readability-rules', () => {
  it('pins the verbatim rule set: four core rules, nothing cut, nothing extra', () => {
    expect(PLAIN_ANSWERS_RULES.split('Core Rule:').length).toBe(5)
    for (const marker of [
      'Core Rule: Answer First',
      'Core Rule: Readable Sentences',
      'Core Rule: One Name Per Concept',
      'Core Rule: Active, Concrete Language',
    ]) {
      expect(PLAIN_ANSWERS_RULES).toContain(marker)
    }
    // The two rules cut at selection stay out of the shipped section.
    expect(PLAIN_ANSWERS_RULES).not.toContain('Scannable Layout')
    expect(PLAIN_ANSWERS_RULES).not.toContain('Read the Reader')
    expect(PLAIN_ANSWERS_RULES.endsWith('.')).toBe(true)
  })

  it('contributes exactly one section with the verbatim text under the REAL composition', async () => {
    root = await mkdtemp(join(tmpdir(), 'readability-loader-'))
    await writeFile(join(root, 'cordis.yml'), [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-readability-rules'",
      '',
    ].join('\n'))
    const ctx = context = new Context()
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', systemPromptPlugin],
      ['@deepseek-ai/dsh-readability-rules', ReadabilityRules],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error('Unexpected Loader import: ' + specifier)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root, 'cordis.yml')).href } })
    await ctx.loader.await()

    const assembly = await ctx.systemPrompt.assemble({})
    const sections = assembly.sections.filter(section => section.name === SECTION_NAME)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.text).toBe(PLAIN_ANSWERS_RULES)
  })

  it('removes the section when the plugin fiber disposes (HMR-safe)', async () => {
    const ctx = context = new Context()
    await ctx.plugin(SystemPrompt)
    const fiber = await ctx.plugin(ReadabilityRules)

    const active = await ctx.systemPrompt.assemble({})
    expect(active.sections.filter(section => section.name === SECTION_NAME)).toHaveLength(1)

    await fiber.dispose()
    const inactive = await ctx.systemPrompt.assemble({})
    expect(inactive.sections.filter(section => section.name === SECTION_NAME)).toHaveLength(0)
  })
})
