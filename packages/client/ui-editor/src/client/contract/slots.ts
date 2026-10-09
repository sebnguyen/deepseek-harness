/**
 * The editor's composition seams: one keyed right-sidebar tab seat the
 * definition claims, and one list hole through which other browser plugins
 * extend the session's source editor. The owner shares one CodeMirror
 * runtime — the provider's module namespaces and the retain-and-replay
 * admission doors — beside a data-level gutter bulletin that parsers
 * without CodeMirror can read.
 */
import type { Compartment, Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { CheckpointSlotTimeline } from '@deepseek-ai/dsh-checkpoint/types'
import type { SessionFile } from '../rpc.ts'

/**
 * The register write face each `editor.annotation` entry receives, wired
 * per session by the registering plugin.
 */
export interface EditorCmEntryInjected {
  /** Put one producer-minted slot into this session's register. */
  readonly putSlot: (slot: {
    readonly slotId: string
    readonly kind: 'note'
    readonly path: string
    readonly label: string
    readonly line: number
    readonly retained: string
    readonly detail: { readonly text: string }
  }) => Promise<unknown>
  /** The register as a file-to-slot-array map. */
  readonly slots: () => Promise<CheckpointSlotTimeline[]>
}

/**
 * One pushed marker of a contributed gutter column: what the editor draws
 * on one line. Pure data — CodeMirror never crosses the plugin boundary.
 */
export interface EditorGutterMarker {
  /** One-based document line the marker sits on. */
  readonly line: number
  /** Text content; empty for glyph-only markers styled by `className`. */
  readonly label: string
  /** Plugin-owned css module classes applied to the drawn element. */
  readonly className?: string
  /** Accessible name; omitted leaves the element unlabelled. */
  readonly ariaLabel?: string
}

/**
 * One contributed gutter column of the session's source editor, described
 * as data and rendered by the editor's single CodeMirror instance.
 */
export interface EditorGutterDescriptor {
  /** Stable column id the descriptor pushes its markers under. */
  readonly id: string
  /** Plugin-owned css module class of the column. */
  readonly className: string
  /** Marker for lines without a pushed one (a per-line affordance), when any. */
  readonly fillUnmarked?: (line: number) => EditorGutterMarker
  /** Click on a drawn marker, with the element's anchor coordinates. */
  readonly onLineClick?: (line: number, x: number, y: number) => void
}

/**
 * The provider's CodeMirror module namespaces: the only runtime copies a
 * contribution may be minted with. Entries import these values, never the
 * packages, so one copy crosses every plugin boundary.
 */
export interface EditorRuntimeModules {
  /** The `@codemirror/state` namespace: effects, fields, compartments. */
  readonly state: typeof import('@codemirror/state')
  /** The `@codemirror/view` namespace: markers, gutters, the view class. */
  readonly view: typeof import('@codemirror/view')
}

/**
 * One owner share an `editor.annotation` entry receives at render time:
 * the addressed file, the shared CodeMirror runtime with its admission
 * doors, and the data-level gutter bulletin the editor composites.
 */
export interface EditorAnnotationOwner {
  /** The session-scoped file the body's view is over. */
  readonly file: SessionFile
  /** One retained snapshot text of this session's store; null when absent. */
  readonly blob: (digest: string) => Promise<string | null>
  /** Bumps once per view creation, so entries republish their markers. */
  readonly viewVersion: number
  /** The provider's CodeMirror namespaces; mint contributions with these. */
  readonly modules: EditorRuntimeModules
  /** The live view while source mode shows one; undefined otherwise. */
  readonly liveView: () => EditorView | undefined
  /**
   * Retain one extension under an id and append it to the live view; the
   * retained value replays into every later generated view.
   * @returns disposer removing the id from the live and future views.
   */
  readonly add: (id: string, extension: Extension) => () => void
  /** Set one compartment's content, installed or swapped in the live view. */
  readonly replace: (id: string, extension: Extension) => void
  /** The stable compartment for an id; its last content replays per view. */
  readonly compartmentOf: (id: string) => Compartment
  /**
   * Register one data-described gutter column; a descriptor present at
   * view creation rides the initial state, a later one reconfigures the
   * live view, and the disposer only shapes later views.
   * @returns disposer removing the column from future view creations.
   */
  readonly describeColumn: (descriptor: EditorGutterDescriptor) => () => void
  /** Publish the descriptor's marker set into the live view. */
  readonly publishMarkers: (id: string, markers: readonly EditorGutterMarker[]) => void
  /** The text of one one-based line of the live document; empty when gone. */
  readonly lineText: (line: number) => string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Annotations composed into the session's source editor by contributing
     * plugins: entries mint extensions with the shared runtime and publish
     * plain gutter markers, so one CodeMirror instance serves every view.
     */
    'editor.annotation': { kind: 'list'; scope: 'session'; owner: EditorAnnotationOwner }
  }
}
