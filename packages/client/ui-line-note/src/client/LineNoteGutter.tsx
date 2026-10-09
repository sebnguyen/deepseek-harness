/**
 * The note gutter: a `+` on every line of the editor's gutter column, a
 * pencil where a note lives, and the popover that writes the note slot
 * through the `slotPut` remote. The column is described as plain marker
 * data for the editor's `editor.annotation` seam — this package carries no
 * CodeMirror; the editor draws the markers through its single instance.
 * The frozen line text rides the put's `retained` so the note keeps
 * pointing at what was meant.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { CheckpointSlot } from '@deepseek-ai/dsh-checkpoint/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { annotationGutter, type EditorCmEntryInjected } from '@deepseek-ai/dsh-client-ui-editor/client'
import { mintNoteId } from './source.ts'
import type { LineNotesSnapshot } from './source.ts'
import css from './LineNoteGutter.module.css'

// The slot contract owns the owner face; the gutter uses its kit and faces.
export type LineNoteGutterProps =
  & PropsRuntime<'editor.annotation'>
  & EditorCmEntryInjected
  & PropsLocale<'lineNote'>

/** One open popover: the line it names, its anchor, and the draft text. */
interface Popover {
  readonly line: number
  readonly x: number
  readonly y: number
  readonly text: string
}

/** The lines a slot list marks; note slots pin their own line. */
export function noteLines(slots: readonly CheckpointSlot[]): readonly number[] {
  return slots.map(slot => slot.line ?? 0).filter(line => line > 0)
}

/**
 * The note gutter contribution; registers one described column and owns
 * the popover that mints note slots.
 * @param props - the annotation owner, the injected put, copy, the hook.
 * @returns the popover while open, nothing otherwise.
 */
export function LineNoteGutter({
  file, viewVersion, add, publishMarkers, lineText, useLineNotes, putSlot, t,
}: LineNoteGutterProps): ReactNode {
  const notes = useLineNotes((snapshot: LineNotesSnapshot) => snapshot.byPath.get(file.path) ?? [])
  const [popover, setPopover] = useState<Popover | undefined>(undefined)
  const noted = useMemo(() => noteLines(notes), [notes])

  // The doors retain the column and replay it into every generated view;
  // disposal rides the effect's unmount.
  useEffect(() => add('line-note', annotationGutter({
    id: 'line-note',
    className: css.gutter as string,
    fillUnmarked: line => ({ line, label: '+', className: css.button as string, ariaLabel: t('addNote') }),
    onLineClick: (line, x, y) => {
      setPopover({ line, x, y, text: '' })
    },
  })), [add, t])

  useEffect(() => {
    publishMarkers('line-note', noted.map(line => ({
      line,
      label: '✎',
      className: `${css.button as string} ${css.noted as string}`,
      ariaLabel: t('hasNote'),
    })))
  }, [noted, viewVersion, publishMarkers, t])

  if (popover === undefined) return null
  const submit = (): void => {
    const text = popover.text.trim()
    if (text === '') return
    void putSlot({
      slotId: mintNoteId(),
      kind: 'note',
      path: file.path,
      label: text,
      line: popover.line,
      retained: lineText(popover.line),
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
