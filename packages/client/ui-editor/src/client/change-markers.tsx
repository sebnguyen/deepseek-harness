/**
 * The source editor's change markers: one gutter dot per line the file's
 * latest frozen stop changed, composed into the live view through the
 * `editor.cm.extension` hole. The markers never write; both sides of the
 * frame are `blob` reads of the recorded digests, and the line set rides a
 * state field the body's view dispatches on each refresh.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { EditorView, GutterMarker, gutter } from '@codemirror/view'
import type { BlockInfo } from '@codemirror/view'
import { Prec, StateEffect, StateField } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import type { FileStop } from '@deepseek-ai/dsh-client-ui-file-history/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { changedLines, markerLines } from './change-lines.ts'
import css from './change-markers.module.css'

/** The markers entry's composed props: the hole's owner plus the session kit. */
export type ChangeMarkersProps = PropsRuntime<'editor.cm.extension'>

/** Replace the marked line set of one view. */
export const setMarkedLines = StateEffect.define<readonly number[]>()

/** The marked line set one view renders; empty until the frame resolves. */
export const markedLinesField = StateField.define<readonly number[]>({
  create: () => [],
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setMarkedLines)) return effect.value
    }
    return value
  },
})

/**
 * The gutter extension drawing one dot per marked line.
 * @returns the composed extension: the field, its gutter, and spacing theme.
 */
/** One gutter dot for a changed line. */
class DotMarker extends GutterMarker {
  override toDOM(): HTMLElement {
    const dot = document.createElement('span')
    dot.className = css.dot as string
    return dot
  }
}

export function markersExtension(): Extension {
  const dot = new DotMarker()
  const one = gutter({
    class: css.gutter as string,
    lineMarker: (view, line: BlockInfo) => {
      const lines = view.state.field(markedLinesField)
      return lines.includes(view.state.doc.lineAt(line.from).number) ? dot : null
    },
    lineMarkerChange: () => true,
  })
  return Prec.highest([markedLinesField, one, EditorView.theme({})])
}

/**
 * One file's change-marker contribution; renders nothing, seeds the live
 * view's marker field from the file's latest frozen stop.
 * @param props - the hole's owner plus the session kit.
 * @returns null; the markers live inside the CodeMirror view.
 */
export function ChangeMarkers({ file, append, blob, view, viewVersion, useFileHistory }: ChangeMarkersProps): ReactNode {
  const [lines, setLines] = useState<readonly number[]>([])
  const appendedRef = useRef(false)
  const history = useFileHistory(snapshot => snapshot)
  const stop: FileStop | undefined = (history.files.find(entry => entry.path === file.path)?.stops ?? []).at(-1)

  useEffect(() => {
    const controller = new AbortController()
    if (stop === undefined || stop.after === undefined) {
      setLines([])
      return () => controller.abort()
    }
    const afterDigest = stop.after
    void Promise.all([
      stop.before === undefined ? Promise.resolve<string | null>('') : blob(stop.before),
      blob(afterDigest),
    ]).then(([before, after]) => {
      if (controller.signal.aborted || before === null || after === null) return
      const change = changedLines(before === '' ? undefined : before, after)
      setLines(markerLines(change, after.split('\n').length))
    }, () => {
      // Abort or transport failure: the view keeps its current marks.
    })
    return () => controller.abort()
  }, [stop, blob])

  useEffect(() => {
    if (!appendedRef.current) {
      appendedRef.current = true
      append(markersExtension())
    }
    view()?.dispatch({ effects: setMarkedLines.of(lines) })
  }, [lines, viewVersion, append, view])

  return null
}
