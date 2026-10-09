/** The body renders the iframe once ready, and the loading or absent line before. */
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { en } from '../src/client/locales.ts'
import type { IdeWireStatus } from '../src/client/rpc.ts'
import { VscodeBody } from '../src/client/VscodeBody.tsx'

const ADDR = 'dsh-resource://file/session/s1/src/a.ts'

afterEach(() => {
  cleanup()
})

function faceOf(statuses: IdeWireStatus[]): { readonly face: object; readonly opens: string[] } {
  const opens: string[] = []
  return {
    opens,
    face: {
      status: async () => statuses[0],
      events: () => ({
        [Symbol.asyncIterator]: async function* () {
          for (const status of statuses) yield status
          await new Promise(() => {})
        },
      }),
      open: async (path: string) => {
        opens.push(path)
      },
    },
  }
}

function mount(face: object): void {
  render(<VscodeBody useTabInfo={() => ({ tab: { contentId: ADDR } })} t={key => en[key]} ide={face as never} />)
}

describe('VscodeBody', () => {
  it('shows the loading line before the first snapshot', () => {
    mount(faceOf([]).face)
    expect(screen.getByRole('status').textContent).toBe(en.loading)
  })

  it('shows the absent line when ready never arrives', async () => {
    mount(faceOf([{ ready: false, twinSha: undefined, reason: 'no-twin', frameUrl: undefined }]).face)
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(en.absent)
    })
  })

  it('mounts the iframe and pushes the open once ready', async () => {
    const { face, opens } = faceOf([
      { ready: true, twinSha: 'f', reason: undefined, frameUrl: 'http://127.0.0.1:41000/?tkn=t' },
    ])
    mount(face)
    await waitFor(() => {
      expect(screen.getByTitle(en.frame)).not.toBeNull()
      expect(opens).toEqual(['src/a.ts'])
    })
  })
})
