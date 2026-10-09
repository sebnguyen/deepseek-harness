/** Wave D glue specs: notes, timeline, gutter, and the revealed posture. */
import { describe, expect, it } from 'vitest'
import { applyChromePosture, LAYOUT_HIDE_COMMANDS } from '../src/bridge.ts'
import { mergeBands, presentGutter, type GutterFace } from '../src/gutter.ts'
import { syncNotes, type CommentsFace, type NoteRecord } from '../src/notes.ts'
import { projectStops, restoreAt, type StopRecord } from '../src/timeline.ts'

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
      replaceThread: (id, body) => {
        const thread = byId.get(id)
        if (thread !== undefined) byId.set(id, { ...thread, body })
        log.push(`replace:${id}`)
      },
      deleteThread: (id) => {
        byId.delete(id)
        log.push(`delete:${id}`)
      },
    },
  }
}

const NOTES = (records: NoteRecord[]): { list(): Promise<NoteRecord[]> } => ({ list: async () => records })

describe('syncNotes', () => {
  it('creates threads once and converges on a second sync', async () => {
    const comments = fakeComments()
    const first = await syncNotes(NOTES([{ id: 'n1', line: 3, text: 'why?', retained: 'x', author: 's' }]), comments.face, new Map())
    expect(first.size).toBe(1)
    await syncNotes(NOTES([{ id: 'n1', line: 3, text: 'why?', retained: 'x', author: 's' }]), comments.face, first)
    expect(comments.log).toEqual(['create:t0@3'])
  })

  it('replaces changed bodies and deletes absent notes', async () => {
    const comments = fakeComments()
    const first = await syncNotes(NOTES([
      { id: 'n1', line: 3, text: 'a', retained: 'x', author: 's' },
      { id: 'n2', line: 9, text: 'b', retained: 'y', author: 's' },
    ]), comments.face, new Map())
    const second = await syncNotes(NOTES([{ id: 'n1', line: 3, text: 'a2', retained: 'x', author: 's' }]), comments.face, first)
    expect(second.size).toBe(1)
    expect(comments.log).toContain('replace:t0')
    expect(comments.log).toContain('delete:t1')
  })
})

const STOPS: StopRecord[] = [
  { turn: 12, tool: 'write', after: 'd12', superseded: true },
  { turn: 14, tool: 'write', after: 'd14', superseded: false },
]

describe('timeline', () => {
  it('projects stops with house label copy, oldest first', () => {
    expect(projectStops(STOPS).map(item => item.label)).toEqual(['turn 12 · write', 'turn 14 · write'])
  })

  it('restores exactly the scrubbed digest and refuses out of range', async () => {
    const restored: string[] = []
    const wire = { stops: async () => STOPS, restore: async (digest: string) => {
      restored.push(digest)
    } }
    await restoreAt(wire, projectStops(STOPS), 1)
    expect(restored).toEqual(['d14'])
    await expect(restoreAt(wire, projectStops(STOPS), 5)).rejects.toMatchObject({ code: 'ide/timeline-out-of-range' })
  })
})

describe('gutter', () => {
  it('merges adjacent same-turn spans and keeps foreign turns disjoint', () => {
    expect(mergeBands([
      { startLine: 10, endLine: 12, turn: 14 },
      { startLine: 13, endLine: 15, turn: 14 },
      { startLine: 13, endLine: 14, turn: 15 },
      { startLine: 20, endLine: 22, turn: 14 },
    ])).toEqual([
      { startLine: 10, endLine: 15, turn: 14 },
      { startLine: 13, endLine: 14, turn: 15 },
      { startLine: 20, endLine: 22, turn: 14 },
    ])
    expect(mergeBands([])).toEqual([])
  })

  it('clears before applying and skips apply on an empty file', () => {
    const cleared: number[] = []
    const applied: unknown[][] = []
    const face: GutterFace = {
      apply: (bands) => {
        applied.push([...bands])
      },
      clear: () => {
        cleared.push(1)
      },
    }
    expect(presentGutter(face, [{ startLine: 3, endLine: 5, turn: 1 }])).toHaveLength(1)
    presentGutter(face, [])
    expect(cleared).toHaveLength(2)
    expect(applied).toHaveLength(1)
  })
})
