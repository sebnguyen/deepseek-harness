/**
 * The CodeMirror 6 assembly one editor view runs: base editing, per-language
 * grammars, and the Mod-S binding that owns saving.
 *
 * Kept apart from the React body so the assembly is testable without a DOM.
 */
import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import type { Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'

/**
 * The grammar one path deserves, or undefined for plain text.
 *
 * A fixed first-party set: JavaScript/TypeScript, JSON, Markdown, Python.
 * Everything else edits unhighlighted until the set grows; adding a language
 * is a static import so the single-file client bundle needs no chunking.
 * @param path - the file path its tab addresses.
 * @returns the language extension, or undefined when none matches.
 */
export function languageFor(path: string): Extension | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  const extension = dot > 0 ? base.slice(dot).toLowerCase() : ''
  switch (extension) {
    case '.ts': return javascript({ typescript: true })
    case '.tsx': return javascript({ typescript: true, jsx: true })
    case '.js':
    case '.mjs':
    case '.cjs': return javascript()
    case '.jsx': return javascript({ jsx: true })
    case '.json':
    case '.jsonc': return json()
    case '.md':
    case '.markdown': return markdown()
    case '.py': return python()
    default: return undefined
  }
}

/**
 * The Mod-S command: always handled, so the browser never opens its own save dialog.
 * @param onSave - the body's save entry point.
 * @returns a CodeMirror command.
 */
export function saveCommand(onSave: () => void): () => boolean {
  return () => {
    onSave()
    return true
  }
}

/**
 * The extension list one editor view runs.
 * @param onSave - the body's save entry point, bound to Mod-S.
 * @param language - the grammar `languageFor` chose for the file, when any.
 * @returns base editing plus the default and history keymaps, the save binding, and the grammar.
 */
export function createEditorExtensions(onSave: () => void, language?: Extension): Extension[] {
  return [
    basicSetup,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    keymap.of([{ key: 'Mod-s', run: saveCommand(onSave), preventDefault: true }]),
    ...(language === undefined ? [] : [language]),
  ]
}
