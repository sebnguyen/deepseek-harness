/**
 * Wave D glue specs: notes, timeline, projections off the checkpoint wire,
 * and the chrome posture.
 */
import type { CheckpointSlot, CheckpointSlotId, CheckpointSlotTimeline, CheckpointStop, CheckpointTimeline, SnapshotDigest } from '@deepseek-ai/dsh-checkpoint/types'
import { describe, expect, it } from 'vitest'
import { applyChromePosture, frameIsLoopback, LAYOUT_HIDE_COMMANDS } from '../src/bridge.ts'
import { syncNotes, type CommentsFace } from '../src/notes.ts'
import { entryFor, NOTE_KIND, notesOf, stopsOf } from '../src/projection.ts'
import { projectStops, restoreAt, TimelineError } from '../src/timeline.ts'

function fakeVscode(): { readonly settings: Array<[string, unknown]>; readonly commands: string[]; readonly face: import('../src/bridge.ts').VscodeGlueFace } {
  const settings: Array<[string, unknown]> = []
  const commands: string[] = []
  return {
    settings,
    commands,
    face: {
      executeOpen: async () => {},
      updateSetting: async (key, value) => {
        settings.push([key, value])
      },
      runLayoutCommand: async (command) => {
        commands.push(command)
      },
    },
  }
}

describe('applyChromePosture', () => {
  it('hides with defaults plus layout commands', async () => {
    const vscode = fakeVscode()
    await applyChromePosture(vscode.face, true)
    expect(vscode.settings.map(([key]) => key)).toEqual(Object.keys({
      'workbench.statusBar.visible': 0,
      'window.menuBarVisibility': 0,
      'workbench.startupEditor': 0,
      'workbench.colorTheme': 0,
    }))
    expect(vscode.commands).toEqual([...LAYOUT_HIDE_COMMANDS])
  })

  it('reveals only the settings the bridge owns, running no layout command', async () => {
    const vscode = fakeVscode()
    await applyChromePosture(vscode.face, false)
    expect(vscode.settings).toEqual([
      ['workbench.statusBar.visible', true],
      ['window.menuBarVisibility', 'classic'],
    ])
    expect(vscode.commands).toEqual([])
  })
})

function slot(line: number | undefined, text: string, kind: string = NOTE_KIND): CheckpointSlot {
  return {
    slotId: `slot-${String(line)}` as CheckpointSlotId,
    kind,
    path: 'src/x.ts',
    label: text,
    ...line === undefined ? {} : { line },
    createdAt: 1,
    detail: kind === NOTE_KIND ? { text } : { toolName: 'write' },
  }
}

const slotTimeline: CheckpointSlotTimeline = {
  path: 'src/x.ts',
  slots: [
    slot(3, 'watch this'),
    slot(7, 'not a note', 'worktree'),
    slot(undefined, 'no line'),
    { ...slot(11, ''), detail: { toolName: 'write' } },
    slot(13, 'second note'),
  ],
}

const stop = (turn: number | undefined, tool: string, after: string | undefined): CheckpointStop => ({
  seq: 0,
  time: 0,
  callId: `c-${tool}-${String(turn)}`,
  toolName: tool,
  ...turn === undefined ? {} : { turn },
  ...after === undefined ? {} : { after: after as SnapshotDigest },
})

const timeline: CheckpointTimeline = {
  path: 'src/x.ts',
  stops: [
    stop(1, 'write', 'd1'),
    { seq: 0, time: 0, callId: 'c2', toolName: 'edit' },
    stop(3, 'write', undefined),
    stop(4, 'edit', 'd4'),
  ],
}

describe('checkpoint projections', () => {
  it('projects note-kind slots with lines onto note records', () => {
    expect(notesOf(slotTimeline)).toEqual([
      { id: 'slot-3', line: 3, text: 'watch this', retained: '', author: 'you' },
      { id: 'slot-13', line: 13, text: 'second note', retained: '', author: 'you' },
    ])
  })

  it('projects turned, committed stops onto stop records', () => {
    expect(stopsOf(timeline)).toEqual([
      { turn: 1, tool: 'write', after: 'd1' },
      { turn: 4, tool: 'edit', after: 'd4' },
    ])
  })

  it('matches register paths to absolute editor paths under the cwd', () => {
    const list = [slotTimeline, { ...slotTimeline, path: 'other.ts' }]
    expect(entryFor('/work', list, '/work/src/x.ts')?.path).toBe('src/x.ts')
    expect(entryFor('/work/', list, '/work/other.ts')?.path).toBe('other.ts')
    expect(entryFor('/work', list, '/elsewhere/src/x.ts')).toBeUndefined()
  })
})

function fakeComments(): { readonly face: CommentsFace; readonly log: string[] } {
  const log: string[] = []
  const byId = new Map<string, { line: number; body: string }>()
  let serial = 0
  return {
    log,
    face: {
      createThread: (line, body, _author) => {
        const id = `t${serial++}`
        byId.set(id, { line, body })
        log.push(`create:${id}@${line}`)
        return id
      },
      replaceThread: (threadId, body) => {
        const existing = byId.get(threadId)
        if (existing !== undefined) existing.body = body
        log.push(`replace:${threadId}`)
      },
      deleteThread: (threadId) => {
        byId.delete(threadId)
        log.push(`delete:${threadId}`)
      },
    },
  }
}

describe('syncNotes convergence over projected notes', () => {
  it('creates threads for notes and converges without churn', async () => {
    const comments = fakeComments()
    const first = await syncNotes({ list: async () => notesOf(slotTimeline) }, comments.face, new Map())
    expect(first.size).toBe(2)
    await syncNotes({ list: async () => notesOf(slotTimeline) }, comments.face, first)
    expect(comments.log).toEqual(['create:t0@3', 'create:t1@13'])
    expect(first.get('slot-3')?.text).toBe('watch this')
  })

  it('replaces changed text and deletes vanished notes', async () => {
    const comments = fakeComments()
    const first = await syncNotes({ list: async () => notesOf(slotTimeline) }, comments.face, new Map())
    const changed = { ...slotTimeline, slots: [slot(3, 'amended')] }
    await syncNotes({ list: async () => notesOf(changed) }, comments.face, first)
    expect(comments.log).toContain('replace:t0')
    expect(comments.log).toContain('delete:t1')
  })
})

describe('timeline', () => {
  it('projects stops onto turn-labeled view items', () => {
    const items = projectStops(stopsOf(timeline))
    expect(items.map(item => item.label)).toEqual(['turn 1 · write', 'turn 4 · edit'])
  })

  it('restores the scrubbed digest and refuses out-of-range indices', async () => {
    const restored: string[] = []
    const items = projectStops(stopsOf(timeline))
    await restoreAt({
      stops: async () => [timeline],
      restore: async (digest) => {
        restored.push(digest)
      },
    }, items, 1)
    expect(restored).toEqual(['d4'])
    await expect(restoreAt({
      stops: async () => [timeline],
      restore: async () => {},
    }, items, 5)).rejects.toBeInstanceOf(TimelineError)
  })
})

describe('frameIsLoopback', () => {
  it('accepts only loopback hosts', () => {
    expect(frameIsLoopback('http://127.0.0.1:9/?tkn=x')).toBe(true)
    expect(frameIsLoopback('http://localhost:9')).toBe(true)
    expect(frameIsLoopback('http://[::1]:9')).toBe(true)
    expect(frameIsLoopback('https://evil.example/?tkn=x')).toBe(false)
    expect(frameIsLoopback('not a url')).toBe(false)
  })
})
