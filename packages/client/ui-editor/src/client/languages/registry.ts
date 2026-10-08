/**
 * The editor's language registry: which language a file is, and the CodeMirror
 * assembly that parses it.
 *
 * One contribution per language (the shipped set is in `./index.ts`) states how
 * it is recognized — an exact file name, a dotted suffix, or the interpreter on
 * the first line — and how it loads. Recognition is a pure function of the path
 * plus, for extensionless scripts, the buffer's first line, so opening,
 * reloading, or re-detecting the same document reaches the same answer.
 *
 * This is a plain collection, not a Cordis service: every language ships in
 * this package's client bundle, so a contribution is an internal module rather
 * than a cross-plugin protocol. A registry whose contributors are separate
 * packages would need one shared CodeMirror module identity first (facet and
 * tag objects compare by identity), which is why it is not one today.
 */
import type { Extension } from '@codemirror/state'
import { fileNameOf } from './path.ts'

/** What one language contributes to the editor. */
export interface LanguageContribution {
  /** Stable identity, unique across the registry. */
  readonly id: string
  /** Dotted lowercase suffixes this language claims, e.g. `.ts`. */
  readonly extensions: readonly string[]
  /** Exact lowercase file names for files no suffix decides, e.g. `.bashrc`. */
  readonly filenames?: readonly string[]
  /** Recognize the document's first line, for scripts that carry an interpreter. */
  readonly firstLine?: (line: string) => boolean
  /**
   * Build the CodeMirror extension for one path.
   * @param path - the path being opened, for languages whose dialect depends on it.
   * @returns the language extension.
   */
  readonly load: (path: string) => Extension
}

/** One resolved recognition: the contribution that claimed a path. */
export interface LanguageMatch {
  /** The claiming contribution's {@link LanguageContribution.id}. */
  readonly id: string
  /** The claiming contribution. */
  readonly contribution: LanguageContribution
}

/**
 * The languages one editor view can detect.
 *
 * Recognition order is exact file name, then the longest matching suffix, then
 * each contribution's first-line test in registration order. Registration is
 * atomic: a conflict or a malformed key reserves nothing.
 */
export class LanguageRegistry {
  private readonly byId = new Map<string, LanguageContribution>()
  private readonly byExtension = new Map<string, LanguageContribution>()
  private readonly byFilename = new Map<string, LanguageContribution>()

  /**
   * Claim one language's names. A conflicting or malformed key throws instead
   * of registering part of the language.
   * @param contribution - the language to add.
   * @returns a disposer releasing the id and every claimed name.
   */
  register(contribution: LanguageContribution): () => void {
    const extensions = contribution.extensions.map((extension) => {
      if (!extension.startsWith('.') || extension !== extension.toLowerCase()) {
        throw new Error(`ui-editor: language "${contribution.id}" declares a malformed extension "${extension}"`)
      }
      return extension
    })
    const filenames = (contribution.filenames ?? []).map((name) => {
      if (name === '' || name !== name.toLowerCase()) {
        throw new Error(`ui-editor: language "${contribution.id}" declares a malformed file name "${name}"`)
      }
      return name
    })
    if (this.byId.has(contribution.id)) {
      throw new Error(`ui-editor: language "${contribution.id}" is already registered`)
    }
    if (new Set(extensions).size !== extensions.length) {
      throw new Error(`ui-editor: language "${contribution.id}" claims a repeated extension`)
    }
    if (new Set(filenames).size !== filenames.length) {
      throw new Error(`ui-editor: language "${contribution.id}" claims a repeated file name`)
    }
    for (const extension of extensions) {
      const owner = this.byExtension.get(extension)
      if (owner !== undefined) {
        throw new Error(`ui-editor: extension "${extension}" is already claimed by "${owner.id}"`)
      }
    }
    for (const name of filenames) {
      const owner = this.byFilename.get(name)
      if (owner !== undefined) {
        throw new Error(`ui-editor: file name "${name}" is already claimed by "${owner.id}"`)
      }
    }
    this.byId.set(contribution.id, contribution)
    for (const extension of extensions) this.byExtension.set(extension, contribution)
    for (const name of filenames) this.byFilename.set(name, contribution)
    return () => {
      if (this.byId.get(contribution.id) === contribution) this.byId.delete(contribution.id)
      for (const extension of extensions) {
        if (this.byExtension.get(extension) === contribution) this.byExtension.delete(extension)
      }
      for (const name of filenames) {
        if (this.byFilename.get(name) === contribution) this.byFilename.delete(name)
      }
    }
  }

  /**
   * Which language claims one path.
   * @param path - the file path a tab addresses.
   * @param text - the buffer, consulted only for a first-line interpreter.
   * @returns the match, or undefined when nothing claims the path.
   */
  resolve(path: string, text?: string): LanguageMatch | undefined {
    const name = fileNameOf(path).toLowerCase()
    const named = this.byFilename.get(name)
    if (named !== undefined) return { id: named.id, contribution: named }
    let dot = name.indexOf('.', 1)
    while (dot > 0) {
      const suffixed = this.byExtension.get(name.slice(dot))
      if (suffixed !== undefined) return { id: suffixed.id, contribution: suffixed }
      dot = name.indexOf('.', dot + 1)
    }
    if (text === undefined) return undefined
    const line = firstLineOf(text)
    for (const contribution of this.byId.values()) {
      if (contribution.firstLine?.(line) === true) return { id: contribution.id, contribution }
    }
    return undefined
  }
}

/**
 * The document's first line, without its line break.
 * @param text - the complete document text.
 * @returns everything before the first newline.
 */
function firstLineOf(text: string): string {
  const end = text.indexOf('\n')
  return end === -1 ? text : text.slice(0, end)
}
