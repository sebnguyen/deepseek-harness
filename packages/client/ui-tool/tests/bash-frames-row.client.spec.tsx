// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { bashFramesModel } from '../src/client/tool/models/bash-frames-model.ts'
import { BashRow, durationText } from '../src/client/tool/toolviews/bash-row.tsx'
import { en, zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'

type BashRowProps = Parameters<typeof BashRow>[0]

const t = makeTranslate(zh, commonZh)
const enT = makeTranslate(en, commonEn)

afterEach(cleanup)

const SID = 's1' as SessionId

const framesArgs = (commands: unknown[] = [{ command: 'ls -la' }, { command: 'pwd' }]): string =>
  JSON.stringify({ commands, description: 'Inspect frames tool surface' })

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'bash', argsRaw: framesArgs(), turn: 1, step: 1, time: 1_000, subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 5_200, callId: 'c1',
  call: { name: 'bash', argsRaw: framesArgs() },
  callTime: 1_000,
  content: [{
    type: 'text',
    text:
      '[1/2] $ ls -la\ntotal 2\ndemo.txt\n[2/2] $ pwd\n/w/app\n[exit code: 1]',
  }],
  isError: false,
  subCalls: [],
  ...over,
})


describe('bashFramesModel', () => {
  it('holds the pending command list while the call runs', () => {
    expect(bashFramesModel(running())).toEqual({
      kind: 'pending',
      commands: [{ command: 'ls -la' }, { command: 'pwd' }],
    })
    expect(bashFramesModel(running({
      argsRaw: framesArgs([{ command: 'ls', workdir: 'packages/ui' }]),
    }))).toEqual({ kind: 'pending', commands: [{ command: 'ls', workdir: 'packages/ui' }] })
  })

  it('splits a settled result into per-frame cards with statuses', () => {
    const model = bashFramesModel(settled())
    expect(model).toEqual({
      kind: 'settled',
      failed: true,
      frames: [
        { kind: 'foreground', command: 'ls -la', workdir: undefined, output: 'total 2\ndemo.txt' },
        { kind: 'foreground', command: 'pwd', workdir: undefined, output: '/w/app', exitCode: 1 },
      ],
    })
  })

  it('reads signals, job acknowledgements, and skip reasons per frame', () => {
    const argsRaw = framesArgs([{ command: 'sleep 9' }, { command: 'make' }, { command: 'ls' }])
    const model = bashFramesModel(settled({
      call: { name: 'bash', argsRaw },
      content: [{
        type: 'text',
        text:
          '[1/3] $ sleep 9\ngone\n[killed by signal: SIGTERM]\n'
          + '[2/3] $ make\nstarted background job bash-7\n'
          + '[3/3] $ ls\n[not run: call aborted]',
      }],
    }))
    expect(model).toEqual({
      kind: 'settled',
      failed: true,
      frames: [
        { kind: 'foreground', command: 'sleep 9', workdir: undefined, output: 'gone', signal: 'SIGTERM' },
        { kind: 'job', command: 'make', jobId: 'bash-7', reason: undefined },
        { kind: 'not-run', command: 'ls', jobId: undefined, reason: 'call aborted' },
      ],
    })
  })

  it('carries persisted per-frame durations from result meta', () => {
    const model = bashFramesModel(settled({
      meta: { frames: [{ index: 0, durationMs: 300 }, { index: 1, durationMs: 3600 }] },
    }))
    expect(model).toMatchObject({
      frames: [{ durationMs: 300 }, { durationMs: 3600, exitCode: 1 }],
    })
    // Malformed meta is ignored rather than trusted.
    expect(bashFramesModel(settled({ meta: { frames: 'nope' } }))).toMatchObject({
      frames: [{}, {}],
    })
    expect(bashFramesModel(settled({ meta: { frames: [{ index: 0, durationMs: -5 }] } })))
      .toMatchObject({ frames: [{}, {}] })
  })

  it('returns null for non-frames blocks so the render site keeps the single-exit row', () => {
    expect(bashFramesModel(running({ parentCallId: 'parent' }))).toBeNull()
    expect(bashFramesModel(running({ name: 'pwsh', argsRaw: '{"command":"ls"}' }))).toBeNull()
    expect(bashFramesModel(running({ argsRaw: '{"command":"ls"}' }))).toBeNull()
    expect(bashFramesModel(running({ argsRaw: '{' }))).toBeNull()
    expect(bashFramesModel(running({ argsRaw: framesArgs([]) }))).toBeNull()
    expect(bashFramesModel(running({ argsRaw: framesArgs([{ command: '  ' }]) }))).toBeNull()
    expect(bashFramesModel(running({ argsRaw: framesArgs([{ command: 'x', workdir: 7 }]) }))).toBeNull()
    expect(bashFramesModel(settled({ isError: true }))).toBeNull()
    expect(bashFramesModel(settled({ content: [] }))).toBeNull()
    // A result the header grammar does not line up with stays generic.
    expect(bashFramesModel(settled({ content: [{ type: 'text', text: 'plain text' }] }))).toBeNull()
  })
})

describe('durationText', () => {
  it('buckets sub-ten-second values at one decimal, then integers, minutes, hours', () => {
    expect(durationText(400, enT)).toBe('0.4s')
    expect(durationText(9_949, enT)).toBe('9.9s')
    expect(durationText(12_000, enT)).toBe('12s')
    expect(durationText(3_600_000 * 2, enT)).toBe('2h')
    expect(durationText(2 * 60_000, enT)).toBe('2m')
    expect(durationText(400, t)).toBe('0.4秒')
    expect(durationText(2 * 60_000, t)).toBe('2分')
    expect(durationText(3_600_000 * 2, t)).toBe('2时')
  })
})

describe('BashRow frames card', () => {
  const props = (block: RunningToolCall | ToolResultNode): BashRowProps => ({
    callId: 'c1', toolName: 'bash', block, openFile: () => {},
    sessionId: SID, useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>({
      ids: [SID],
      byId: { [SID]: { id: SID, displayTitle: 'r', running: false, blank: false, updatedAt: 0, cwd: '/w/app' } as never },
      current: undefined,
      phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, jobOutputBySession: {},
      currentAddress: undefined,
    })),
    t: enT,
  } as unknown as BashRowProps)

  it('renders one running terminal card per pending element with a live suffix', async () => {
    const view = render(<BashRow {...props(running())} />)
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    await waitFor(() => expect(view.container.querySelectorAll('[data-terminal][data-running]')).toHaveLength(2))
    expect(view.container.textContent).toContain('ls -la')
    const suffix = view.container.querySelector('[data-live]')
    expect(suffix).not.toBeNull()
    await waitFor(() => {
      expect(suffix!.textContent).not.toBe('0.0s')
    }, { timeout: 2_000 })
    view.unmount()
  })

  it('settles each frame with its own output, exit pill, and persisted duration', async () => {
    const view = render(<BashRow {...props(settled({
      meta: { frames: [{ index: 0, durationMs: 300 }, { index: 1, durationMs: 3_600 }] },
    }))} />)
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    await waitFor(() => expect(view.container.querySelectorAll('[data-terminal]')).toHaveLength(2))
    // The failing frame turns the whole row red and reads its exit pill.
    expect(view.container.querySelector('[data-sample="bash"]')!.getAttribute('data-state')).toBe('error')
    expect(view.container.textContent).toContain('exit code 1')
    // Per-card accessories carry the localized durations.
    expect(view.container.textContent).toContain('0.3s')
    expect(view.container.textContent).toContain('3.6s')
    // The row suffix carries the call's total: 4.2s.
    expect(view.container.textContent).toContain('4.2s')
  })

  it('renders job frames with the detach glyph and not-run frames with the warning dot', async () => {
    const argsRaw = framesArgs([{ command: 'make' }, { command: 'ls' }])
    const view = render(<BashRow {...props(settled({
      call: { name: 'bash', argsRaw },
      content: [{
        type: 'text',
        text: '[1/2] $ make\nstarted background job bash-7\n[2/2] $ ls\n[not run: call aborted]',
      }],
    }))} />)
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    await waitFor(() => expect(view.container.querySelectorAll('[data-detached]')).toHaveLength(2))
    expect(view.container.textContent).toContain('backgrounded · bash-7')
    expect(view.container.textContent).toContain('skipped · call aborted')
    expect(view.container.textContent).not.toContain('started background job')
  })

  it('labels the frame prompt with an element workdir resolved against the session workspace', async () => {
    const view = render(<BashRow {...props(settled({
      call: { name: 'bash', argsRaw: framesArgs([{ command: 'ls', workdir: 'packages/ui' }]) },
      content: [{ type: 'text', text: '[1/1] $ ls\nok\n' }],
    }))} />)
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    await waitFor(() => expect(view.container.querySelector('[data-terminal]')).not.toBeNull())
    // promptLabel prints the last path segment of /w/app/packages/ui.
    expect(view.container.textContent).toContain('ui')
  })

  it('expands on click and Enter, collapsing again', async () => {
    const view = render(<BashRow {...props(settled())} />)
    const head = view.container.querySelector('[data-expandable]')!
    expect(view.container.querySelector('[data-terminal]')).toBeNull()
    fireEvent.click(head)
    await waitFor(() => expect(view.container.querySelector('[data-terminal]')).not.toBeNull())
    fireEvent.keyDown(head, { key: 'Enter' })
    await waitFor(() => expect(view.container.querySelector('[data-terminal]')).toBeNull())
  })

  it('keeps the bounded IN/OUT card for an errored batch and the terminal card for single-exit calls', async () => {
    const errored = render(<BashRow {...props(settled({
      isError: true,
      content: [{ type: 'text', text: 'Error: invalid commands' }],
    }))} />)
    fireEvent.click(errored.container.querySelector('[data-expandable]')!)
    await waitFor(() => expect(errored.container.querySelector('[data-terminal]')).toBeNull())
    expect(errored.container.textContent).toContain('Error: invalid commands')
    const singular = render(<BashRow {...props({
      ...settled(),
      call: { name: 'bash', argsRaw: '{"command":"ls -la","description":"List files"}' },
      content: [{ type: 'text', text: 'total 2\n' }],
    })} />)
    // Single-exit calls keep today's card behind the same expand interaction.
    expect(singular.container.querySelector('[data-terminal]')).toBeNull()
    fireEvent.click(singular.container.querySelector('[data-expandable]')!)
    await waitFor(() => expect(singular.container.querySelector('[data-terminal]')).not.toBeNull())
    // A clean single-exit call carries no batch suffix.
    expect(singular.container.querySelector('[data-live]')).toBeNull()
  })

  it('labels a stopped batch row from the interrupt error', () => {
    const view = render(<BashRow {...props(settled({
      content: [{ type: 'text', text: '[1/2] $ ls -la\n[not run: call aborted]\n[2/2] $ pwd\n[not run: call aborted]' }],
      error: { name: 'AbortError', code: 'interrupted' },
    }))} />)
    expect(view.container.querySelector('[data-sample="bash"]')!.getAttribute('data-state')).toBe('stopped')
  })
})
