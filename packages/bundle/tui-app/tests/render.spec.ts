/** The terminal application's pure render helpers. */

import { describe, expect, it } from 'vitest'
import { paint, paintAll, SGR, cursorUp, cursorRight } from '../src/ansi.ts'
import {
  banner,
  formatCount,
  formatUsage,
  HELP_TEXT,
  summarizeToolCall,
  terminalWidth,
  truncateLines,
} from '../src/render.ts'

describe('paint', () => {
  it('wraps text when enabled and passes it through when disabled', () => {
    expect(paint(true, 'red', 'x')).toBe('\x1B[31mx\x1B[0m')
    expect(paint(false, 'red', 'x')).toBe('x')
    expect(paint(true, 'red', '')).toBe('')
  })

  it('composes several codes in one pass', () => {
    expect(paintAll(true, ['bold', 'cyan'], '›')).toBe(`${SGR.bold}${SGR.cyan}›${SGR.reset}`)
  })

  it('computes cursor motion strings', () => {
    expect(cursorUp(3)).toBe('\x1B[3A')
    expect(cursorUp(0)).toBe('')
    expect(cursorRight(5)).toBe('\x1B[5C')
    expect(cursorRight(-1)).toBe('')
  })
})

describe('terminalWidth', () => {
  it('clamps to a sane region and defaults to 80', () => {
    expect(terminalWidth(undefined)).toBe(80)
    expect(terminalWidth(5)).toBe(20)
    expect(terminalWidth(500)).toBe(240)
    expect(terminalWidth(120)).toBe(120)
  })
})

describe('truncateLines', () => {
  it('keeps short text intact', () => {
    expect(truncateLines('one\ntwo', 4, 20)).toEqual({ text: 'one\ntwo', omitted: 0 })
  })

  it('keeps the first lines and counts the rest', () => {
    expect(truncateLines('1\n2\n3\n4\n5', 2, 20)).toEqual({ text: '1\n2', omitted: 3 })
  })

  it('elides over-wide single lines', () => {
    expect(truncateLines('abcdefgh', 4, 5)).toEqual({ text: 'abcd…', omitted: 0 })
  })

  it('treats trailing newlines and empty input as empty', () => {
    expect(truncateLines('', 4, 20)).toEqual({ text: '', omitted: 0 })
    expect(truncateLines('done\n', 4, 20)).toEqual({ text: 'done', omitted: 0 })
  })
})

describe('formatCount/formatUsage', () => {
  it('renders compact token counts', () => {
    expect(formatCount(340)).toBe('340')
    expect(formatCount(2400)).toBe('2.4k')
    expect(formatCount(24000)).toBe('24k')
  })

  it('renders a full usage figure or nothing', () => {
    expect(formatUsage({ inputTokens: 2400, outputTokens: 340 })).toBe('↑ 2.4k · ↓ 340')
    expect(formatUsage(undefined)).toBe('')
  })
})

describe('summarizeToolCall', () => {
  it('prefers the harness purpose line', () => {
    expect(summarizeToolCall('bash', '{"command":"ls"}', 'List the directory')).toBe('bash — List the directory')
  })

  it('falls back to the most recognizable argument', () => {
    expect(summarizeToolCall('bash', '{"command":"pnpm test"}')).toBe('bash · pnpm test')
    expect(summarizeToolCall('grep', '{"pattern":"slot"}')).toBe('grep · slot')
    expect(summarizeToolCall('read', '{"file_path":"/tmp/x"}')).toBe('read · /tmp/x')
  })

  it('compacts long commands and malformed input', () => {
    const long = 'git log ' + 'x'.repeat(100)
    const summary = summarizeToolCall('bash', JSON.stringify({ command: long }))
    expect(summary.startsWith('bash · git log ')).toBe(true)
    expect(summary.endsWith('…')).toBe(true)
    expect(summary.length).toBeLessThanOrEqual(72 + 7)
    expect(summarizeToolCall('bash', 'not json')).toBe('bash')
    expect(summarizeToolCall('unknown', '{"a":1}')).toBe('unknown {"a":1}')
  })
})

describe('banner', () => {
  const facts = { cwd: '/tmp/repo', provider: 'anthropic', model: 'claude-x', sessionId: 'session-1' }

  it('announces the model, cwd, and session with styling', () => {
    const text = banner(facts, true, 80)
    expect(text).toContain('\x1B[')
    expect(text).toContain('anthropic/claude-x')
    expect(text).toContain('/tmp/repo')
    expect(text).toContain('session-1')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('stays completely ANSI-free without color', () => {
    const text = banner(facts, false, 80)
    expect(text).not.toContain('\x1B[')
    expect(text).toContain('dsh')
  })
})

describe('HELP_TEXT', () => {
  it('lists the advertised commands', () => {
    for (const command of ['/help', '/clear', '/model', '/status', '/approval', '/quit']) {
      expect(HELP_TEXT).toContain(command)
    }
  })
})
