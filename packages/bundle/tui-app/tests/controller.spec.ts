/** The terminal application's framework-free view-model. */

import { describe, expect, it } from 'vitest'

import { SPINNER, TuiController } from '../src/controller.ts'
import type { ApprovalOutcome, TuiDelegate } from '../src/controller.ts'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** One harness->controller drive with the delegate capture objects. */
interface Fixture {
  controller: TuiController
  prompts: string[]
  calls: { interrupt: number; quit: number; clear: number }
  advance(ms: number): void
}

/** Create a controller over mutable time with a capturing delegate. */
function makeController(): Fixture {
  let now = 10_000
  const prompts: string[] = []
  const calls = { interrupt: 0, quit: 0, clear: 0 }
  const delegate: TuiDelegate = {
    prompt: (text) => { prompts.push(text) },
    interrupt: () => { calls.interrupt += 1 },
    clear: () => { calls.clear += 1 },
    quit: () => { calls.quit += 1 },
    facts: () => 'deepseek/deepseek-chat · /tmp/repo',
    statusLine: busy => `session session-1 · ${busy ? 'working' : 'idle'} · cwd /tmp/repo`,
    approvalLabel: () => 'ask (default)',
    setApprovalMode: mode => mode,
  }
  const controller = new TuiController(delegate, () => now)
  return { controller, prompts, calls, advance: (ms) => { now += ms } }
}

/** A chunk-free assistant frame. */
function chunkFrame(chunk: unknown): AssistantStreamFrame {
  return { type: 'chunk', chunk } as AssistantStreamFrame
}

/** A minimal session event envelope. */
function eventOf(type: string, data: unknown): SessionEvent {
  return { type, data } as SessionEvent
}

describe('submitLine', () => {
  it('appends the prompt as a user entry and forwards it to the agent', () => {
    const fixture = makeController()
    fixture.controller.submitLine('fix the build')
    expect(fixture.prompts).toEqual(['fix the build'])
    expect(fixture.controller.entries[0]?.kind).toBe('user')
  })

  it('announces queued prompts while a turn runs', () => {
    const fixture = makeController()
    fixture.controller.ingestEvent(eventOf('turn/start', { turn: 1 }))
    fixture.controller.submitLine('and also lint')
    expect(fixture.prompts).toEqual(['and also lint'])
    const kinds = fixture.controller.entries.map(entry => entry.kind)
    expect(kinds).toContain('note')
  })

  it('ignores blank input', () => {
    const fixture = makeController()
    fixture.controller.submitLine('   ')
    expect(fixture.prompts).toEqual([])
    expect(fixture.controller.entries).toHaveLength(0)
  })
})

describe('slash commands', () => {
  it('prints help and unknown-command errors as entries', () => {
    const fixture = makeController()
    fixture.controller.submitLine('/help')
    fixture.controller.submitLine('/nope')
    const kinds = fixture.controller.entries.map(entry => entry.kind)
    expect(kinds).toEqual(['help', 'error'])
  })

  it('answers /model, /status and /approval from the delegate', () => {
    const fixture = makeController()
    fixture.controller.submitLine('/model')
    fixture.controller.submitLine('/status')
    fixture.controller.submitLine('/approval never')
    fixture.controller.submitLine('/approval')
    const text = fixture.controller.entries.map(entry => JSON.stringify(entry)).join('\n')
    expect(text).toContain('deepseek/deepseek-chat')
    expect(text).toContain('session-1')
    expect(text).toContain('approval policy: never')
  })

  it('/clear notes the restart and asks the delegate to recompose', () => {
    const fixture = makeController()
    fixture.controller.submitLine('/clear')
    expect(fixture.calls.clear).toBe(1)
    expect(fixture.controller.entries.map(entry => entry.kind)).toContain('note')
  })

  it('/quit fires the handshake exactly once', () => {
    const fixture = makeController()
    let quits = 0
    fixture.controller.onQuit(() => { quits += 1 })
    fixture.controller.submitLine('/quit')
    expect(fixture.calls.quit).toBe(1)
    expect(quits).toBe(1)
  })
})

describe('ctrl+c', () => {
  it('interrupts a running turn instead of quitting', () => {
    const fixture = makeController()
    fixture.controller.ingestEvent(eventOf('turn/start', { turn: 1 }))
    fixture.controller.ctrlC()
    expect(fixture.calls.interrupt).toBe(1)
    expect(fixture.calls.quit).toBe(0)
  })

  it('quits on the second idle strike inside the window', () => {
    const fixture = makeController()
    fixture.controller.ctrlC()
    expect(fixture.calls.quit).toBe(0)
    fixture.advance(800)
    fixture.controller.ctrlC()
    expect(fixture.calls.quit).toBe(1)
  })

  it('arms again after the strike window expires', () => {
    const fixture = makeController()
    fixture.controller.ctrlC()
    fixture.advance(2000)
    fixture.controller.ctrlC()
    expect(fixture.calls.quit).toBe(0)
  })
})

describe('approvals', () => {
  it('exposes the question until the view answers it', async () => {
    const fixture = makeController()
    const ask = fixture.controller.requestApproval({ toolName: 'write', reason: 'writes a file' })
    expect(fixture.controller.pendingApproval?.toolName).toBe('write')
    fixture.controller.approve('allowed-once')
    await expect(ask).resolves.toBe('allowed-once' satisfies ApprovalOutcome)
    expect(fixture.controller.pendingApproval).toBeUndefined()
    expect(fixture.controller.entries.at(-1)?.kind).toBe('approval')
  })

  it('rejects outstanding questions on shutdown', async () => {
    const fixture = makeController()
    const ask = fixture.controller.requestApproval({ toolName: 'bash' })
    fixture.controller.answerApprovals()
    await expect(ask).resolves.toBe('rejected')
    expect(fixture.controller.pendingApproval).toBeUndefined()
  })
})

describe('turn lifecycle', () => {
  it('accumulates the stream and commits it at turn/end with figures', () => {
    const fixture = makeController()
    fixture.controller.ingestEvent(eventOf('turn/start', { turn: 3 }))
    fixture.controller.ingestFrame(chunkFrame({ type: 'reasoning-delta', text: 'thinking…' }))
    fixture.controller.ingestFrame(chunkFrame({ type: 'text-delta', text: 'hello' }))
    fixture.controller.ingestFrame(chunkFrame({ type: 'usage', usage: { inputTokens: 100, outputTokens: 2300 } }))
    expect(fixture.controller.working?.answer).toBe('hello')
    fixture.advance(3400)
    fixture.controller.ingestEvent(eventOf('turn/end', { turn: 3, reason: { kind: 'completed' } }))
    expect(fixture.controller.working).toBeUndefined()
    const turns = fixture.controller.entries.filter(entry => entry.kind === 'turn')
    expect(turns).toHaveLength(1)
    expect(JSON.stringify(turns[0])).toContain('↑ 100 · ↓ 2.3k')
    expect(JSON.stringify(turns[0])).toContain('"durationSeconds":"3.4"')
    const kinds = fixture.controller.entries.map(entry => entry.kind)
    expect(kinds).toContain('reasoning')
    expect(kinds).toContain('assistant')
  })

  it('renders turn failures as error entries', () => {
    const fixture = makeController()
    fixture.controller.ingestEvent(eventOf('turn/start', { turn: 1 }))
    fixture.controller.ingestEvent(eventOf('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { code: 'provider/timeout', message: 'timed out' } },
    }))
    const errors = fixture.controller.entries.filter(entry => entry.kind === 'error')
    expect(errors).toHaveLength(1)
    expect(JSON.stringify(errors[0])).toContain('provider/timeout')
  })

  it('spins the status glyph from the clock', () => {
    const fixture = makeController()
    fixture.controller.ingestEvent(eventOf('turn/start', { turn: 1 }))
    const first = fixture.controller.spinGlyph()
    fixture.advance(500)
    const second = fixture.controller.spinGlyph()
    expect(SPINNER).toContain(first)
    expect(SPINNER).toContain(second)
  })
})

describe('tool events', () => {
  it('renders tool calls as one-line summaries', () => {
    const fixture = makeController()
    fixture.controller.ingestEvent(eventOf('tool/call', {
      name: 'bash',
      arguments: JSON.stringify({ command: 'ls -la' }),
    }))
    const last = fixture.controller.entries.at(-1)
    expect(last?.kind).toBe('tool-call')
    expect(JSON.stringify(last)).toContain('ls -la')
  })

  it('previews tool results and counts hidden lines', () => {
    const fixture = makeController()
    const body = 'line1\nline2\nline3\nline4\nline5\nline6'
    fixture.controller.ingestEvent(eventOf('tool/result', {
      message: { content: [{ type: 'text', text: body }] },
    }))
    const last = fixture.controller.entries.at(-1)
    expect(last?.kind).toBe('tool-result')
    expect(JSON.stringify(last)).toContain('line1')
    expect(JSON.stringify(last)).toContain('"extra":2')
  })

  it('marks failed tool results', () => {
    const fixture = makeController()
    fixture.controller.ingestEvent(eventOf('tool/result', {
      message: { content: [{ type: 'text', text: 'boom' }] },
      error: { code: 'tool/failed', message: 'boom' },
    }))
    const last = fixture.controller.entries.at(-1)
    expect(last?.kind).toBe('tool-result')
    expect(JSON.stringify(last)).toContain('tool/failed')
  })
})
