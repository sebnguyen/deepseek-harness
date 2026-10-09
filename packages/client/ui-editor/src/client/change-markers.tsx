/**
 * The source editor's change markers: one gutter dot per line the file's
 * latest frozen stop changed, published as plain marker data through the
 * `editor.annotation` slot. The markers never write; both sides of the
 * frame are `blob` reads of the recorded digests, and the editor draws the
 * published lines through its single CodeMirror instance.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { FileStop } from '@deepseek-ai/dsh-client-ui-file-history/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { changedLines, markerLines } from './change-lines.ts'
import css from './change-markers.module.css'

/** The markers entry's composed props: the annotation owner plus the kit. */
export type ChangeMarkersProps = PropsRuntime<'editor.annotation'>

/**
 * One file's change-marker contribution; renders nothing, publishes the
 * changed-line dots of the file's latest frozen stop as gutter markers.
 * @param props - the slot owner plus the file-history hook.
 * @returns null; the dots live inside the editor's view.
 */
export function ChangeMarkers({ file, blob, viewVersion, describeColumn, publishMarkers, useFileHistory }: ChangeMarkersProps): ReactNode {
  const [lines, setLines] = useState<readonly number[]>([])
  const history = useFileHistory(snapshot => snapshot)
  const stop: FileStop | undefined = (history.files.find(entry => entry.path === file.path)?.stops ?? []).at(-1)

  useEffect(() => {
    const controller = new AbortController()
    if (stop === undefined || stop.after === undefined) {
      setLines([])
      return () => {
        controller.abort()
      }
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
    return () => {
      controller.abort()
    }
  }, [stop, blob])

  useEffect(() => describeColumn({ id: 'change-markers', className: css.gutter as string }), [describeColumn])

  useEffect(() => {
    publishMarkers('change-markers', lines.map(line => ({ line, label: '', className: css.dot as string })))
  }, [lines, viewVersion, publishMarkers])

  return null
}
