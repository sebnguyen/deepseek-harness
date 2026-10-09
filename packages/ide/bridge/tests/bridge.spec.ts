/**
 * The bridge glue: posture applied exactly once, hello, then the open drain.
 */
import { describe, expect, it } from 'vitest'
import { activateBridge, CHROME_DEFAULTS, LAYOUT_HIDE_COMMANDS } from '../src/bridge.ts'

function fakeVscode(): { readonly face: import('../src/bridge.ts').VscodeGlueFace; readonly settings: Array<[string, unknown]>; readonly commands: string[]; readonly opens: string[] } {
  const settings: Array<[string, unknown]> = []
  const commands: string[] = []
  const opens: string[] = []
  return {
    settings,
    commands,
    opens,
    face: {
      executeOpen: async (path) => {
        opens.push(path)
      },
      updateSetting: async (key, value) => {
        settings.push([key, value])
      },
      runLayoutCommand: async (command) => {
        commands.push(command)
      },
    },
  }
}

describe('activateBridge', () => {
  it('applies the posture, hellos, and drains opens until the queue is empty', async () => {
    const vscode = fakeVscode()
    const queue = ['a.ts', 'b.ts']
    const hellos = { count: 0 }
    const dispose = await activateBridge(vscode.face, {
      hello: async () => {
        hellos.count += 1
        return true
      },
      openNext: async () => queue.shift(),
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(vscode.settings).toEqual(Object.entries(CHROME_DEFAULTS))
    expect(vscode.commands).toEqual([...LAYOUT_HIDE_COMMANDS])
    expect(hellos.count).toBe(1)
    expect(vscode.opens).toEqual(['a.ts', 'b.ts'])
    dispose()
  })

  it('stops the drain when the host says so before the queue empties', async () => {
    const vscode = fakeVscode()
    const queue = ['a.ts', 'b.ts', 'c.ts']
    let live = true
    const dispose = await activateBridge(vscode.face, {
      hello: async () => true,
      openNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 1))
        return queue.shift()
      },
    }, () => live)
    live = false
    dispose()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(vscode.opens.length).toBeLessThan(3)
  })
})
