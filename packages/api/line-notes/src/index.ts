/**
 * LineNotes: the `lineNotes` Remote namespace — a projection over the
 * checkpoint slot register.
 *
 * One note model, one store: every `note`-kind slot in the session's slot
 * register (`remote.checkpoint.slots`; clients also read it directly) is one
 * line note. `lineNotes.state` projects the register into note rows;
 * `lineNotes.add` is the typed write direction — it appends one
 * `kind: 'note'` slot through the checkpoint service, matching the web
 * gutter's own slot payload. `lineNotes.focus` stays the editor-to-host
 * uplink, re-emitted locally as the `lineNotes/focus` event.
 * @module @deepseek-ai/dsh-api-line-notes
 */

import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CheckpointSlot } from '@deepseek-ai/dsh-checkpoint/types'
import type {} from '@deepseek-ai/dsh-checkpoint'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  LineNote,
  LineNoteAddRequest,
  LineNoteFocusRequest,
  LineNotesState,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `lineNotes` Remote namespace. */
    lineNotes: LineNotes
  }
  interface Events {
    /**
     * Re-emit of the editor's `lineNotes.focus` uplink for face-local consumers.
     * @mode emit
     * @param request - the validated focus landing the editor reported.
     */
    'lineNotes/focus'(request: LineNoteFocusRequest): void
  }
}

/** Mint one note slot id: `note-` plus twelve random hex characters (the web producer's own mint). */
function mintNoteId(): string {
  return `note-${randomBytes(6).toString('hex')}`
}

/** Project one checkpoint slot into a note row, or null when it is not a note. */
function noteOfSlot(slot: CheckpointSlot): LineNote | null {
  if (slot.kind !== 'note' || slot.line === undefined) return null
  const text = (slot.detail as { readonly text?: string }).text ?? slot.label
  return { id: slot.slotId, path: slot.path, line: slot.line, text }
}

/** The `lineNotes` remote face: note reads project the register, writes append to it. */
export class LineNotes extends TypertRemoteService {
  static readonly inject: readonly string[] = ['checkpoint']

  constructor(ctx: Context) {
    super(ctx, 'lineNotes')
  }

  /** Read the session's note list, projected live from its slot register. */
  @Remote
  async state(session: Session, signal: AbortSignal): Promise<LineNotesState> {
    void signal
    const timelines = await this.ctx.checkpoint.slots(session, undefined)
    const notes: LineNote[] = []
    for (const timeline of timelines) {
      for (const slot of timeline.slots) {
        const note = noteOfSlot(slot)
        if (note !== null) notes.push(note)
      }
    }
    return { notes }
  }

  /**
   * Pin one note (uplink from any editor): validate, mint the id, and append
   * the `note` slot the web gutter writes verbatim.
   */
  @Remote
  async add(session: Session, note: LineNoteAddRequest, signal: AbortSignal): Promise<LineNote> {
    void signal
    if (typeof note.path !== 'string' || note.path.length === 0) {
      throw new RemoteError('gateway/bad-request', 'add path must be non-empty', {})
    }
    if (!Number.isSafeInteger(note.line) || note.line < 1) {
      throw new RemoteError('gateway/bad-request', 'add line must be a positive safe integer', {})
    }
    const text = typeof note.text === 'string' ? note.text.trim() : ''
    if (text.length === 0) {
      throw new RemoteError('gateway/bad-request', 'add text must be non-empty', {})
    }
    if (typeof note.retained !== 'string') {
      throw new RemoteError('gateway/bad-request', 'add retained must be the frozen line text', {})
    }
    const slotId = mintNoteId()
    await this.ctx.checkpoint.putSlotRemote(session, {
      slotId,
      kind: 'note',
      path: note.path,
      label: text,
      line: note.line,
      retained: note.retained,
      detail: { text },
    })
    return { id: slotId, path: note.path, line: note.line, text }
  }

  /**
   * The editor landed on a note (uplink from any engine). Validated and
   * re-emitted locally; the base service deliberately routes further.
   */
  @Remote
  focus(request: LineNoteFocusRequest, signal: AbortSignal): void {
    void signal
    if (!Number.isSafeInteger(request.line) || request.line < 1) {
      throw new RemoteError('gateway/bad-request', 'focus line must be a positive safe integer', {})
    }
    if (request.path.length === 0) {
      throw new RemoteError('gateway/bad-request', 'focus path must be non-empty', {})
    }
    this.ctx.emit('lineNotes/focus', request)
  }
}

export default LineNotes
