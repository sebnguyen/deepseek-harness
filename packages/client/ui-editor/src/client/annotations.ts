/**
 * The editor-owned gutter compositor. `ui-editor` is the only package that
 * imports CodeMirror: contributing plugins describe their gutter columns
 * as plain data through the `editor.annotation` slot owner, and this module
 * renders every descriptor through the body's single view instance, so no
 * extension object ever crosses a plugin boundary.
 */
import { GutterMarker, gutter } from '@codemirror/view'
import type { BlockInfo } from '@codemirror/view'
import { Prec, StateEffect, StateField } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import type { EditorGutterDescriptor, EditorGutterMarker } from './contract/slots.ts'

/** Replace one descriptor's pushed marker set of every view. */
export const setGutterMarkers = StateEffect.define<{
  readonly id: string
  readonly markers: readonly EditorGutterMarker[]
}>()

/** The pushed markers per descriptor id; foreign transactions keep it. */
export const gutterMarkersField = StateField.define<Readonly<Record<string, readonly EditorGutterMarker[]>>>({
  create: () => ({}),
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setGutterMarkers)) return { ...value, [effect.value.id]: effect.value.markers }
    }
    return value
  },
})

/** One drawn marker: a button when its column takes clicks, a span otherwise. */
class DataMarker extends GutterMarker {
  constructor(
    private readonly marker: EditorGutterMarker,
    private readonly open?: (x: number, y: number) => void,
  ) {
    super()
  }

  override toDOM(): HTMLElement {
    const open = this.open
    const element: HTMLElement = open === undefined
      ? document.createElement('span')
      : document.createElement('button')
    if (open !== undefined) {
      const button = element as HTMLButtonElement
      button.type = 'button'
      button.addEventListener('click', () => {
        const box = button.getBoundingClientRect()
        open(box.right, box.top)
      })
    }
    element.className = this.marker.className ?? ''
    element.dataset.line = String(this.marker.line)
    element.textContent = this.marker.label
    if (this.marker.ariaLabel !== undefined) element.setAttribute('aria-label', this.marker.ariaLabel)
    return element
  }
}

/**
 * The CodeMirror extension rendering one data-described gutter column.
 * @param descriptor - the contributing plugin's column description.
 * @returns the column extension; compose once per registration.
 */
export function annotationGutter(descriptor: EditorGutterDescriptor): Extension {
  const column = gutter({
    class: descriptor.className,
    renderEmptyElements: descriptor.fillUnmarked !== undefined,
    lineMarker: (view, line: BlockInfo) => {
      const number = view.state.doc.lineAt(line.from).number
      const markers = view.state.field(gutterMarkersField)[descriptor.id] ?? []
      const marker = markers.find(candidate => candidate.line === number)
        ?? descriptor.fillUnmarked?.(number)
      if (marker === undefined) return null
      return new DataMarker(
        marker,
        descriptor.onLineClick === undefined ? undefined : (x, y) => descriptor.onLineClick?.(number, x, y),
      )
    },
    lineMarkerChange: () => true,
  })
  return Prec.highest([gutterMarkersField, column])
}
