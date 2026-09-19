/**
 * Behavior suite for the knowledge-notes plugin: the store's read-as-no-note
 * contract, the two tools through the real tool registry, the pinned read-time
 * pointer (live/stale/orphaned/silent), and the once-per-turn refresh
 * obligation derived from the session log.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as KnowledgeNotes from '../src/index.ts'
import type { KnowledgeNotesTurnState } from '../src/types.ts'
import { NoteStore } from '../src/store.ts'
import { sourceHash } from '../src/hash.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

let dir: string
let home: string
let ctx: Context
let fiber: Awaited<ReturnType<Context['plugin']>>

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-knowledge-notes-cwd-'))
  home = await mkdtemp(join(tmpdir(), 'dsh-knowledge-notes-home-'))
  ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  await ctx.plugin(ToolFs)
  fiber = await ctx.plugin(KnowledgeNotes, { dshHome: home })
})

afterEach(async () => {
  await fiber.dispose()
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

const testToolSignal = new AbortController().signal
let callCounter = 0

/** Execute one tool as an agent session without a header cwd (the provider dir applies). */
function call(name: string, args: unknown, withAgent = true) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...(withAgent ? { agent: { session: { header: {} } } as never } : {}),
  })
}

/** A note store bound to this test's home, for seeding and direct assertions. */
const storeFor = (): NoteStore => new NoteStore(ctx.fs, `${home}/knowledge/notes`)

/** Write a note for `target` as `upsert_note` would. */
async function seedNote(target: string, claim: string, content: string): Promise<void> {
  const targetFs = await ctx.fs.resolve(target, {})
  await ctx.fs.writeText(targetFs, content)
  await storeFor().put({
    target: targetFs.displayPath,
    claim,
    affirmedAgainst: sourceHash(content),
    hashScheme: 'source-norm@1',
    author: 'agent',
  })
}

/** Every knowledge-notes pointer message attached to one tool result. */
function pointerContexts(result: ToolExecutionResult): { text: string; source: unknown }[] {
  return (result.additionalContexts ?? []).map(message => ({
    text: message.content.map(block => block.type === 'text' ? block.text : '').join(''),
    source: message.source,
  }))
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** Every injected-context message in the agent's log, flattened to text. */
function injections(agent: Agent): { text: string; source: unknown }[] {
  return agent.session.snapshotEvents()
    .filter((event): event is SessionEvent<'user/message'> => event.type === 'user/message' && event.data.source.kind !== 'user')
    .map(event => ({
      text: event.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
      source: event.data.source,
    }))
}

const isKnowledgeNotes = (source: unknown): boolean =>
  typeof source === 'object' && source !== null && (source as { plugin?: string }).plugin === 'knowledge-notes'

describe('store', () => {
  it('round-trips a record and derives the note path from the target path', async () => {
    const store = storeFor()
    const target = await ctx.fs.resolve(join(dir, 'a.ts'), {})
    await store.put({ target: target.displayPath, claim: 'c', affirmedAgainst: 'sha256:x', hashScheme: 'source-norm@1', author: 'agent' })
    expect(await store.forTarget(target)).toMatchObject({ claim: 'c' })
    expect(store.notePathFor(target.displayPath))
      .toBe(`${home}/knowledge/notes${join(dir, 'a.ts').split('\\').join('/')}.json`)
  })

  it('reads a tombstone, malformed JSON, and a mislocated record all as no note', async () => {
    const store = storeFor()
    const target = await ctx.fs.resolve(join(dir, 'a.ts'), {})
    await store.put({ target: target.displayPath, claim: 'c', affirmedAgainst: 'h', hashScheme: 'source-norm@1', author: 'agent' })
    // A record at a path that disagrees with its target is a mislocated note.
    await ctx.fs.writeText(await ctx.fs.resolve(store.notePathFor(target.displayPath), {}),
      JSON.stringify({ target: '/somewhere/else.ts', claim: 'c', affirmedAgainst: 'h', hashScheme: 'source-norm@1', author: 'agent' }))
    expect(await store.forTarget(target)).toBeUndefined()
    await store.remove(target)
    expect(await store.forTarget(target)).toBeUndefined()
    // The malformed case: hand-edited content degrades to no note, file left in place.
    const notePath = store.notePathFor(target.displayPath)
    await ctx.fs.writeText(await ctx.fs.resolve(notePath, {}), '{not json')
    expect(await store.forTarget(target)).toBeUndefined()
    expect(await readFile(notePath, 'utf8')).toBe('{not json')
  })

  it('reports live, stale, and orphaned against the target', async () => {
    const store = storeFor()
    const target = await ctx.fs.resolve(join(dir, 'a.ts'), {})
    await ctx.fs.writeText(target, 'one')
    const note = { target: target.displayPath, claim: 'c', affirmedAgainst: sourceHash('one'), hashScheme: 'source-norm@1', author: 'agent' as const }
    expect(await store.stateOf(target, note)).toBe('live')
    await ctx.fs.writeText(target, 'one\n')
    expect(await store.stateOf(target, note)).toBe('stale')
    expect(await store.stateOf(await ctx.fs.resolve(join(dir, 'gone.ts'), {}), note)).toBe('orphaned')
  })

  it('never serves a note whose target is under the store root', async () => {
    const store = storeFor()
    const inner = await ctx.fs.resolve(`${store.root}/nested.ts`, {})
    expect(await store.forTarget(inner)).toBeUndefined()
  })
})

describe('record validation', () => {
  it.each([
    ['a null document', 'null'],
    ['an array', '[1]'],
    ['an empty claim', (target: string) => JSON.stringify({ target, claim: '', affirmedAgainst: 'h', hashScheme: 'source-norm@1', author: 'agent' })],
    ['an empty hash', (target: string) => JSON.stringify({ target, claim: 'c', affirmedAgainst: '', hashScheme: 'source-norm@1', author: 'agent' })],
    ['a foreign scheme', (target: string) => JSON.stringify({ target, claim: 'c', affirmedAgainst: 'h', hashScheme: 'source-norm@2', author: 'agent' })],
    ['a foreign author', (target: string) => JSON.stringify({ target, claim: 'c', affirmedAgainst: 'h', hashScheme: 'source-norm@1', author: 'human' })],
  ])('reads %s as no note', async (_name, body: string | ((target: string) => string)) => {
    const store = storeFor()
    const target = await ctx.fs.resolve(join(dir, 'a.ts'), {})
    const notePath = store.notePathFor(target.displayPath)
    await mkdir(dirname(notePath), { recursive: true })
    await writeFile(notePath, typeof body === 'string' ? body : body(target.displayPath))
    expect(await store.forTarget(target)).toBeUndefined()
  })
})

describe('obligation listener', () => {
  it('declines when the turn already steered, and reports the cwd-relative path', async () => {
    await writeFile(join(dir, 'a.ts'), 'old')
    await seedNote('a.ts', 'old fact', 'old')
    const adapter = new MockAdapter([
      toolCallResponse('c0', 'write', { file_path: 'a.ts', content: 'new\n' }),
      textResponse('done'),
      textResponse('acknowledged'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('n3'), { provider: 'mock', model: 'mock' }, { cwd: dir })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    const obligations = () => injections(agent).filter(entry => entry.text.startsWith('File notes need re-checking:'))
    expect(obligations()).toHaveLength(1)
    // Re-invoking the serial listener for the same turn declines on the logged steer.
    await noticeListener()({ agent, signal: testToolSignal })
    expect(obligations()).toHaveLength(1)
  })

  it('declines when no touched file carries a note', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c0', 'write', { file_path: 'plain.ts', content: 'x\n' }),
      textResponse('done'),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('n3'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    const before = injections(agent).length
    await noticeListener()({ agent, signal: testToolSignal })
    expect(injections(agent).length).toBe(before)
  })
})

describe('tools', () => {
  it('upsert_note stamps the current hash and read_note reports the state', async () => {
    await writeFile(join(dir, 'a.ts'), 'one')
    expect((await call('upsert_note', { target: 'a.ts', claim: 'The first attempt counts.' })).isError).toBe(false)
    const read = await call('read_note', { target: 'a.ts' })
    expect(read.value).toMatchObject({ found: true, state: 'live', claim: 'The first attempt counts.' })
    expect((await call('read_note', { target: join(dir, 'never.ts') })).value).toMatchObject({ found: false })
  })

  it('an empty claim deletes, after which the note reads as absent', async () => {
    await writeFile(join(dir, 'a.ts'), 'one')
    await seedNote('a.ts', 'before', 'one')
    const removed = await call('upsert_note', { target: 'a.ts', claim: '' })
    expect(removed.isError).toBe(false)
    expect((await call('read_note', { target: 'a.ts' })).value).toMatchObject({ found: false })
  })

  it('upsert_note refuses to affirm a note for a missing file', async () => {
    const result = await call('upsert_note', { target: join(dir, 'gone.ts'), claim: 'x' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toContain('does not exist')
  })
})

describe('pointer', () => {
  it('attaches the pinned live pointer to a read of a noted file and nothing to an unnoted read', async () => {
    await writeFile(join(dir, 'a.ts'), 'one')
    await writeFile(join(dir, 'b.ts'), 'two')
    await seedNote('a.ts', 'one fact', 'one')
    const noted = await call('read', { file_path: 'a.ts' })
    const pointers = pointerContexts(noted)
    expect(pointers).toHaveLength(1)
    expect(pointers[0]!.text).toBe(`Note for ${join(dir, 'a.ts')} (current): ${home}/knowledge/notes${join(dir, 'a.ts')}.json`)
    const unnoted = await call('read', { file_path: 'b.ts' })
    expect(pointerContexts(unnoted)).toHaveLength(0)
  })

  it('does not fire for an agentless caller', async () => {
    await writeFile(join(dir, 'a.ts'), 'one')
    await seedNote('a.ts', 'one fact', 'one')
    const result = await call('read', { file_path: 'a.ts' }, false)
    expect(pointerContexts(result)).toHaveLength(0)
  })

  it('words stale and orphaned distinctly', async () => {
    await writeFile(join(dir, 'a.ts'), 'one')
    await seedNote('a.ts', 'fact', 'one')
    await writeFile(join(dir, 'a.ts'), 'changed under it')
    expect(pointerContexts(await call('read', { file_path: 'a.ts' }))[0]!.text).toContain('is stale')
    await writeFile(join(dir, 'c.ts'), 'x')
    await seedNote('c.ts', 'fact', 'prior')
    await rm(join(dir, 'c.ts'))
    expect(pointerContexts(await call('read', { file_path: 'c.ts' }))[0]!.text).toContain('is orphaned')
  })

  it('never chains a pointer onto the read of a note file', async () => {
    await seedNote(join(dir, 'a.ts'), 'fact', 'one')
    const notePath = storeFor().notePathFor(join(dir, 'a.ts'))
    const result = await call('read', { file_path: notePath })
    expect(result.isError).toBe(false)
    expect(pointerContexts(result)).toHaveLength(0)
  })
})

describe('pointer fold', () => {
  /** One agent session with an explicit cwd, exercising the cwd-bearing resolve. */
  const cwdCall = (name: string, args: unknown) => ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`cwd-${++callCounter}`),
    name,
    arguments: args,
    agent: { session: { header: { cwd: dir } } } as never,
  })

  /** A downstream listener returning `downstream` with one extra context prepended, or a block carrying one. */
  function attachExtra(block: boolean): void {
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      const downstream = await next()
      const extra = createUserMessage({ content: [{ type: 'text', text: 'extra' }], source: { kind: 'plugin', plugin: 'test-extra' } as never })
      if (block) return { kind: 'block', feedback: [{ type: 'text', text: 'blocked' }], additionalContexts: [extra] }
      return { ...downstream, additionalContexts: [extra, ...(downstream.additionalContexts ?? [])] }
    })
  }

  it('folds onto inherited contexts with the session cwd', async () => {
    await writeFile(join(dir, 'a.ts'), 'one')
    await seedNote('a.ts', 'fact', 'one')
    attachExtra(false)
    const result = await cwdCall('read', { file_path: 'a.ts' })
    expect(result.additionalContexts).toHaveLength(2)
    expect(pointerContexts(result)[0]!.text).toContain('(current)')
  })

  it('folds the pointer onto a block decision', async () => {
    await writeFile(join(dir, 'a.ts'), 'one')
    await seedNote('a.ts', 'fact', 'one')
    attachExtra(true)
    const result = await cwdCall('read', { file_path: 'a.ts' })
    expect(result.isError).toBe(true)
    // The blocker's own context survives; the pointer rides the same decision.
    expect(pointerContexts(result)).toHaveLength(2)
    expect(pointerContexts(result).some(entry => entry.text.includes('Note for'))).toBe(true)
  })
})

describe('turn-boundary obligation', () => {
  it('steers exactly once per turn for a noted file the turn wrote', async () => {
    await writeFile(join(dir, 'a.ts'), 'old')
    await seedNote('a.ts', 'old fact', 'old')
    const adapter = new MockAdapter([
      toolCallResponse('c0', 'write', { file_path: 'a.ts', content: 'new\n' }),
      textResponse('done'),
      textResponse('acknowledged'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('n1'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const notes = injections(agent).filter(entry => isKnowledgeNotes(entry.source))
    const obligations = notes.filter(entry => entry.text.startsWith('File notes need re-checking:'))
    expect(obligations).toHaveLength(1)
    expect(obligations[0]!.text).toContain('a.ts')
  })

  it('stays silent when no touched file carries a note', async () => {
    const adapter = new MockAdapter([
      toolCallResponse('c0', 'write', { file_path: 'plain.ts', content: 'x\n' }),
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('n2'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(injections(agent)).toHaveLength(0)
  })
})

/** The plugin's notice listener bound to the harness under test. */
function noticeListener() {
  return KnowledgeNotes.noticeRefreshObligation(ctx, storeFor())
}

/** A minimal plugin message source for fold tests. */
const knowledgeNotesSource = (): { kind: string; plugin: string } => ({ kind: 'plugin', plugin: 'knowledge-notes' })

describe('projection fold', () => {
  const toolCall = (name: string, args: unknown, turn = 1): SessionEvent =>
    ({ type: 'tool/call', data: { turn, step: 1, callId: ToolCallId('c'), name, arguments: JSON.stringify(args) } }) as SessionEvent
  const userMessage = (text: string): SessionEvent =>
    ({
      type: 'user/message',
      data: createUserMessage({ content: [{ type: 'text', text }], source: knowledgeNotesSource() as never }),
    }) as unknown as SessionEvent

  it('folds only mutating calls of the current turn, and the obligation dedupes on its pinned head', () => {
    const { apply, init } = KnowledgeNotes.knowledgeNotesProjection as unknown as {
      apply: (state: KnowledgeNotesTurnState, event: SessionEvent) => KnowledgeNotesTurnState
      init: () => KnowledgeNotesTurnState
    }
    let state = init()
    state = apply(state, { type: 'tool/call', data: { turn: 1, step: 1, callId: ToolCallId('c'), name: 'read', arguments: '{"file_path":"a.ts"}' } } as SessionEvent)
    expect(state.touched).toHaveLength(0)
    state = apply(state, toolCall('write', { file_path: 'a.ts' }))
    expect(state.touched).toEqual([{ turn: 1, path: 'a.ts' }])
    // Editor view is a read wearing the editor schema; it does not touch.
    state = apply(state, toolCall('str_replace_editor', { command: 'view', path: 'a.ts' }))
    expect(state.touched).toHaveLength(1)
    // The editor's mutating commands do touch, and duplicates collapse at read time not fold time.
    state = apply(state, toolCall('str_replace_editor', { command: 'str_replace', path: 'b.ts' }))
    expect(state.touched).toHaveLength(2)
    // A mutating tool with no path argument drops the touch.
    state = apply(state, toolCall('write', {}))
    expect(state.touched).toHaveLength(2)
    // Unparseable arguments (a foreign writer) drop the touch rather than break the fold.
    state = apply(state, { type: 'tool/call', data: { turn: 1, step: 1, callId: ToolCallId('c'), name: 'write', arguments: '{nope' } } as SessionEvent)
    expect(state.touched).toHaveLength(2)
    // A new turn resets the touched set and the dedupe.
    state = apply(state, { type: 'turn/start', data: { turn: 2 } } as SessionEvent)
    expect(state).toEqual({ touched: [], steered: false })
  })

  it('the obligation message is its own dedupe record', () => {
    const { apply, init } = KnowledgeNotes.knowledgeNotesProjection as {
      apply: (state: KnowledgeNotesTurnState, event: SessionEvent) => KnowledgeNotesTurnState
      init: () => KnowledgeNotesTurnState
    }
    let state = init()
    state = apply(state, userMessage('File notes need re-checking: /a.ts. Re-read each.'))
    expect(state.steered).toBe(true)
    // A read-time pointer carries the same plugin source but never dedupes.
    state = apply(state, userMessage('Note for /a.ts (current): /notes/a.ts.json'))
    expect(state.steered).toBe(true)
  })
})
