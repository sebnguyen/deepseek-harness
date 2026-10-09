/**
 * The note gutter: a `+` in the gutter column left of the line number, a
 * pencil where a note lives, and the popover that writes the note slot
 * through the `slotPut` remote. The frozen line text rides the put's
 * `retained` so the note keeps pointing at what was meant.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { EditorView, GutterMarker, gutter } from '@codemirror/view'
import type { BlockInfo } from '@codemirror/view'
import { Prec, StateEffect, StateField } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import type { CheckpointSlot } from '@deepseek-ai/dsh-checkpoint/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { EditorCmEntryInjected } from '@deepseek-ai/dsh-client-ui-editor/client'
import { mintNoteId } from './source.ts'
import type { LineNotesSnapshot } from './source.ts'
import type { LineNoteKey } from './locales.ts'
import css from './LineNoteGutter.module.css'

/** Translate bound to the `lineNote` namespace. */
export type LineNoteTranslate = (key: LineNoteKey, params?: Record<string, unknown>) => string

// The slot contract owns the entry inject face; the gutter uses its put.
export type LineNoteInjected = EditorCmEntryInjected

/** The gutter entry's composed props: the hole's owner, the inject face, copy, the hook. */
export type LineNoteGutterProps =
  & PropsRuntime<'editor.cm.extension'>
  & EditorCmEntryInjected
  & PropsLocale<'lineNote'>

/** One open popover: the line it names, its anchor, and the draft text. */
interface Popover {
  readonly line: number
  readonly x: number
  readonly y: number
  readonly text: string
}

/** Replace the visible note line set of one view. */
export const setNoteLines = StateEffect.define<readonly number[]>()

/** The note lines one view renders; empty until the register resolves. */
export const noteLinesField = StateField.define<readonly number[]>({
  create: () => [],
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setNoteLines)) return effect.value
    }
    return value
  },
})

/**
 * The gutter extension: one widget per line, `+` on hover or a pencil where
 * the field names a note line.
 * @param open - called with the line and anchor when a widget is clicked.
 * @param t - the bound `lineNote` translate.
 * @returns the composed extension: field, gutter, theme.
 */
/** One gutter widget: `+`, or a pencil where the field names a note. */
class NoteMarker extends GutterMarker {
  constructor(
    private readonly line: number,
    private readonly noted: boolean,
    private readonly open: (line: number, x: number, y: number) => void,
    private readonly t: LineNoteTranslate,
  ) {
    super()
  }

  override toDOM(): HTMLElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = this.noted
      ? `${css.button as string} ${css.noted as string}`
      : css.button as string
    button.dataset.line = String(this.line)
    button.textContent = this.noted ? '✎' : '+'
    button.setAttribute('aria-label', this.t(this.noted ? 'hasNote' : 'addNote'))
    button.addEventListener('click', () => {
      const box = button.getBoundingClientRect()
      this.open(this.line, box.right, box.top)
    })
    return button
  }
}

export function noteGutterExtension(open: (line: number, x: number, y: number) => void, t: LineNoteTranslate): Extension {
  const one = gutter({
    class: css.gutter as string,
    renderEmptyElements: true,
    lineMarker: (view, line: BlockInfo) => {
      const lines = view.state.field(noteLinesField)
      const number = view.state.doc.lineAt(line.from).number
      return new NoteMarker(number, lines.includes(number), open, t)
    },
    lineMarkerChange: () => true,
  })
  return Prec.highest([noteLinesField, one, EditorView.theme({})])
}

/** The note lines a slot list shows; note slots pin their own line. */
export function noteLines(slots: readonly CheckpointSlot[]): readonly number[] {
  return slots.map(slot => slot.line ?? 0).filter(line => line > 0)
}

/**
 * The note gutter contribution; appends one extension and owns the popover.
 * @param props - the hole's owner, the injected put, copy, and the hook.
 * @returns the popover while open, nothing otherwise.
 */
export function LineNoteGutter({
  file, append, view, viewVersion, useLineNotes, putSlot, t,
}: LineNoteGutterProps): ReactNode {
  const notes = useLineNotes((snapshot: LineNotesSnapshot) => snapshot.byPath.get(file.path) ?? [])
  const [popover, setPopover] = useState<Popover | undefined>(undefined)
  const appendedRef = useRef(false)
  // The effect below appends the extension once, so the opener captured at
  // mount must stay valid: the state setter is stable for the component's life.
  const open = (line: number, x: number, y: number): void => {
    setPopover({ line, x, y, text: '' })
  }

  useEffect(() => {
    if (!appendedRef.current) {
      appendedRef.current = true
      append(noteGutterExtension(open, t))
    }
    view()?.dispatch({ effects: setNoteLines.of(noteLines(notes)) })
  }, [notes, viewVersion, append, view, t])


  if (popover === undefined) return null
  const lineText = (): string => {
    const current = view()
    if (current === undefined || popover.line > current.state.doc.lines) return ''
    return current.state.doc.line(popover.line).text
  }
  const submit = (): void => {
    const text = popover.text.trim()
    if (text === '') return
    void putSlot({
      slotId: mintNoteId(),
      kind: 'note',
      path: file.path,
      label: text,
      line: popover.line,
      retained: lineText(),
      detail: { text },
    }).then(() => { setPopover(undefined) })
  }
  return (
    <div className={css.pop} style={{ left: popover.x, top: popover.y }} data-note-popover="">
      <textarea
        autoFocus
        value={popover.text}
        placeholder={t('placeholder', { n: popover.line })}
        onChange={(event) => { setPopover({ ...popover, text: event.target.value }) }}
      />
      <button type="button" onClick={submit}>{t('submit')}</button>
      <button type="button" onClick={() => { setPopover(undefined) }}>{t('cancel')}</button>
    </div>
  )
}
