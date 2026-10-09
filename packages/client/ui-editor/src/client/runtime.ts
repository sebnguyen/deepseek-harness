/**
 * The editor's admission doors: one retained contribution registry per
 * body. Views are re-created on every loaded generation, so a raw
 * `appendConfig` from a contributor would die at the next reload; these
 * doors retain every contribution and replay the retained set into each
 * generated view, dispatching the live-view half themselves. The editor
 * stays the sole CodeMirror dispatcher.
 */
import { Compartment, StateEffect } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * The three doors plus the generation compositor and the live-view bind.
 */
export interface EditorDoors {
  /**
   * Retain one extension under an id and append it to the live view; a
   * later id replaces the retained value. Every later generation composes
   * the retained value without another dispatch.
   * @param id - contribution id the disposer and a later add address.
   * @param extension - the retained extension, minted with the runtime's namespaces.
   * @returns disposer removing the id from the live and future views.
   */
  readonly add: (id: string, extension: Extension) => () => void
  /**
   * Set one compartment's content; the first call installs the
   * compartment, later calls swap it through `reconfigure`.
   * @param id - compartment id shared with {@link compartmentOf}.
   * @param extension - the compartment's new content.
   */
  readonly replace: (id: string, extension: Extension) => void
  /**
   * The stable compartment for an id; holders may reconfigure it live while
   * the doors replay its last content into every generation.
   * @param id - compartment id shared with {@link replace}.
   * @returns the compartment, minted once per id.
   */
  readonly compartmentOf: (id: string) => Compartment
  /**
   * The retained contributions to compose into one generated view: the
   * added extensions plus every compartment over its last content.
   * @returns the replayed extension set.
   */
  readonly compose: () => Extension[]
  /**
   * Bind the doors to the live view; undefined unbinds at view disposal.
   * @param view - the body's current view, when source mode shows one.
   */
  readonly attach: (view: EditorView | undefined) => void
}

/** One retained compartment entry. */
interface CompartmentEntry {
  readonly compartment: Compartment
  content: Extension
  installed: boolean
}

/**
 * One body's retained contribution registry.
 * @returns the doors over a fresh, empty registry.
 */
export function createEditorDoors(): EditorDoors {
  const retained = new Map<string, Extension>()
  const compartments = new Map<string, CompartmentEntry>()
  let live: EditorView | undefined
  const entryFor = (id: string): CompartmentEntry => {
    let entry = compartments.get(id)
    if (entry === undefined) {
      entry = { compartment: new Compartment(), content: [], installed: false }
      compartments.set(id, entry)
    }
    return entry
  }
  return {
    add: (id, extension) => {
      retained.set(id, extension)
      live?.dispatch({ effects: StateEffect.appendConfig.of(extension) })
      return () => {
        retained.delete(id)
      }
    },
    replace: (id, extension) => {
      const entry = entryFor(id)
      entry.content = extension
      if (!entry.installed) {
        entry.installed = true
        live?.dispatch({ effects: StateEffect.appendConfig.of(entry.compartment.of(extension)) })
      }
      else live?.dispatch({ effects: entry.compartment.reconfigure(extension) })
    },
    compartmentOf: id => entryFor(id).compartment,
    compose: () => [
      ...retained.values(),
      ...[...compartments.values()].map(entry => entry.compartment.of(entry.content)),
    ],
    attach: (view) => {
      live = view
    },
  }
}
