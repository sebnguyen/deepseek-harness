/**
 * The editor's composition seams: one keyed right-sidebar tab seat the
 * definition claims, and one list hole through which other browser plugins
 * compose CodeMirror extensions into the session's source editor.
 */
import type { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type { CheckpointSlotTimeline } from '@deepseek-ai/dsh-checkpoint/types'
import type { SessionFile } from '../rpc.ts'

/**
 * The register write face each `editor.cm.extension` entry receives, wired
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
 * One owner share an `editor.cm.extension` entry receives at render time:
 * the addressed file, and the sole supported mutation of the live view.
 */
export interface EditorCmExtensionOwner {
  /** The session-scoped file the body's view is over. */
  readonly file: SessionFile
  /**
   * Append one extension to the live view (`appendConfig`); extensions present
   * at view creation time ride the initial state. Views are created per loaded
   * generation, so a disposer only shapes later views.
   * @returns disposer removing the extension from future view creations.
   */
  readonly append: (extension: Extension) => () => void
  /** One retained snapshot text of this session's store; null when absent. */
  readonly blob: (digest: string) => Promise<string | null>
  /** The live view while the edit mode shows it; undefined otherwise. */
  readonly view: () => EditorView | undefined
  /** Bumps once per view creation, so entries reseed fields into fresh views. */
  readonly viewVersion: number
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * CodeMirror extensions composed into the session's source editor by
     * contributng plugins; each entry owns its extension's lifecycle.
     */
    'editor.cm.extension': { kind: 'list'; scope: 'session'; owner: EditorCmExtensionOwner }
  }
}
