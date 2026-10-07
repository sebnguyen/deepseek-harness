/**
 * Shared exit-status parse contract: the inverse of the `[exit code: N]` /
 * `[killed by signal: X]` markers `dsh-tool-bash` and `dsh-tool-pwsh` append.
 * Both tools' presenter suites round-trip their own renderers through this
 * parse; this spec pins the parse's own edges (marker-like output, body
 * slicing) once, at the seam that owns it.
 */

import { describe, expect, it } from 'vitest'
import { parseExitStatus, renderFrames } from '../src/render.ts'

describe('parseExitStatus', () => {
  it('recovers a clean exit 0 with the body verbatim when no marker is present', () => {
    expect(parseExitStatus('hi\n\n')).toEqual({ body: 'hi\n\n', exitCode: 0 })
    expect(parseExitStatus('')).toEqual({ body: '', exitCode: 0 })
  })

  it('recovers a non-zero exit and strips only its marker from the body', () => {
    expect(parseExitStatus('oops\n[exit code: 3]')).toEqual({ body: 'oops', exitCode: 3 })
    // The marker needs the leading newline and the end of the string, so a
    // clean result whose output merely ENDS in marker-like text is not read
    // as a failure and the text stays in the body.
    expect(parseExitStatus('[exit code: 5]')).toEqual({ body: '[exit code: 5]', exitCode: 0 })
  })

  it('recovers a signal kill ahead of any non-zero exit marker', () => {
    expect(parseExitStatus('gone\n[killed by signal: SIGKILL]')).toEqual({ body: 'gone', signal: 'SIGKILL' })
    // A fake signal marker with no leading newline is output, not a kill.
    expect(parseExitStatus('[killed by signal: SIGKILL]')).toEqual({ body: '[killed by signal: SIGKILL]', exitCode: 0 })
  })

  it('keeps markers no pill shows (timeout) in the body', () => {
    expect(parseExitStatus('slow\n[timed out after 100ms]\n[exit code: 143]'))
      .toEqual({ body: 'slow\n[timed out after 100ms]', exitCode: 143 })
  })
})

describe('renderFrames', () => {
  it('sections each element under its submission-order header with singular markers', () => {
    const text = renderFrames([
      {
        index: 0,
        command: 'echo a',
        outcome: {
          kind: 'foreground',
          exitCode: 0,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: 1000,
          stdout: { text: 'a\n', truncated: false },
          stderr: { text: '', truncated: false },
        },
      },
      {
        index: 1,
        command: 'boom',
        outcome: {
          kind: 'foreground',
          exitCode: 3,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: 1000,
          stdout: { text: '', truncated: false },
          stderr: { text: 'bad\n', truncated: false },
          sandbox: { mode: 'read-only', denied: true },
        },
      },
    ])
    expect(text).toContain('[1/2] $ echo a\na\n')
    expect(text).toContain('[2/2] $ boom\n[stderr]\nbad\n')
    expect(text).toContain('[sandbox: file access denied under read-only mode]')
    expect(text).toContain('[exit code: 3]')
  })

  it('renders job and not-run arms verbatim', () => {
    const text = renderFrames([
      { index: 0, command: 'sleep 9', outcome: { kind: 'job', jobId: 'bash-7' } },
      { index: 1, command: 'skipped', outcome: { kind: 'not-run', reason: 'call aborted' } },
    ])
    expect(text).toBe('[1/2] $ sleep 9\nstarted background job bash-7\n[2/2] $ skipped\n[not run: call aborted]')
  })

  it('appends the escalation hint to denied sections when escalation is advertised', () => {
    const text = renderFrames([
      {
        index: 0,
        command: 'denied',
        outcome: {
          kind: 'foreground',
          exitCode: 1,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: 1000,
          stdout: { text: '', truncated: false },
          stderr: { text: '', truncated: false },
          sandbox: { mode: 'read-only', denied: true },
        },
      },
    ], ['workspace-write'])
    expect(text).toContain('[sandbox: file access denied under read-only mode]')
    expect(text).toContain('sandbox_permissions')
  })
})
