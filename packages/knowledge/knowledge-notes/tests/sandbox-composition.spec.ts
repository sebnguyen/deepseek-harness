/**
 * Real-composition test: `upsert_note` must persist a note under a
 * sandbox-enforcing filesystem in every mode, because note files are harness
 * state written with `node:fs` (like session-log persistence), not model file
 * mutation subject to the fence. Both the workspace and the note home are
 * placed outside automatic temp grants so the assertion actually distinguishes
 * "note store bypasses the fence" from "the path happens to be temp-writable".
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import * as KnowledgeNotes from '../src/index.ts'
import { NoteStore } from '../src/store.ts'
import { outsideTempWorkspaceParent } from '../../../../scripts/snapshot-workspace-parent.ts'

let ws: string
let home: string
let ctx: Context
let fiber: Awaited<ReturnType<Context['plugin']>>

async function boot(mode: SandboxMode): Promise<void> {
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(SandboxPolicyService, { mode, workspaceRoot: ws })
  await ctx.plugin(SandboxedFileSystem, { cwd: ws })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(ToolFs)
  fiber = await ctx.plugin(KnowledgeNotes, { dshHome: home })
}

beforeEach(async () => {
  const parent = outsideTempWorkspaceParent()
  ws = await mkdtemp(join(parent, 'dsh-notes-ws-'))
  home = await mkdtemp(join(parent, 'dsh-notes-home-'))
})

afterEach(async () => {
  await fiber?.dispose()
  await rm(ws, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

const store = (): NoteStore => new NoteStore(ctx.fs, `${home}/knowledge/notes`)

describe.each(['read-only', 'workspace-write', 'danger-full-access'] as const)('%s session', (mode) => {
  it('persists a note outside the workspace and temp grants, while ctx.fs writes stay fenced', async () => {
    await boot(mode)
    await writeFile(join(ws, 'a.ts'), 'one')
    const target = await ctx.fs.resolve(join(ws, 'a.ts'), {})

    // A plain fs write outside every writable root observes the session fence.
    if (mode !== 'danger-full-access') {
      await expect(ctx.fs.writeText(await ctx.fs.resolve(join(home, 'probe.txt'), {}), 'x'))
        .rejects.toThrow(FsError)
    }

    // The note store's own write is harness state and must succeed in every mode.
    await store().put({
      target: target.displayPath,
      claim: 'fact',
      affirmedAgainst: 'sha256:x',
      hashScheme: 'source-norm@1',
      author: 'agent',
    })
    const parsed = JSON.parse(await readFile(store().notePathFor(target.displayPath), 'utf8'))
    expect(parsed.claim).toBe('fact')
  })
})
