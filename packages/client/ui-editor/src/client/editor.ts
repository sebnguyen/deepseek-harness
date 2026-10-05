/**
 * The CodeMirror 6 assembly one editor view runs: base editing, per-language
 * grammars, the Mod-S binding that owns saving, and the theme pair that rides
 * the product's design tokens, so the view follows the appearance flip
 * without a second theme.
 *
 * Kept apart from the React body so the assembly is testable without a DOM.
 */
import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { basicSetup } from 'codemirror'

/**
 * The dotted lowercase suffix one path carries, or the empty string.
 * @param path - the file path its tab addresses.
 * @returns `.ext` from the last segment, lowercased; `''` without one.
 */
function extensionOf(path: string): string {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

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
  switch (extensionOf(path)) {
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
 * Whether the tab body offers the rendered display mode for this path.
 * @param path - the file path its tab addresses.
 * @returns true exactly for the suffixes the Markdown grammar claims.
 */
export function isMarkdownPath(path: string): boolean {
  const extension = extensionOf(path)
  return extension === '.md' || extension === '.markdown'
}

/**
 * The editor chrome in product tokens: every color is a `--dsw-*` alias, so
 * light and dark appearances need no separate theme spec.
 * @returns the CodeMirror view theme.
 */
export function editorTheme(): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      color: 'var(--dsw-alias-label-primary)',
      backgroundColor: 'transparent',
    },
    '.cm-scroller': {
      fontFamily: 'var(--ds-font-family-code)',
      fontSize: '13px',
      lineHeight: '1.7',
    },
    '.cm-content': { caretColor: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--dsw-alias-interactive-bg-active)',
    },
    '.cm-activeLine': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--dsw-alias-label-primary)' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--dsw-alias-label-caption)',
      border: 'none',
      borderRight: '0.5px solid var(--dsw-alias-border-l1)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '24px' },
    '.cm-foldGutter .cm-gutterElement': { color: 'var(--dsw-alias-label-caption)' },
    '.cm-line': { padding: '0 16px' },
    '.cm-selectionMatch': { backgroundColor: 'var(--dsw-alias-markdown-tag)' },
    '.cm-matchingBracket': {
      backgroundColor: 'var(--dsw-alias-interactive-bg-hover)',
      outline: '1px solid var(--dsw-alias-border-l2)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      borderColor: 'var(--dsw-alias-border-l1)',
    },
  })
}

/**
 * Token colors for the grammars in the same appearance-following aliases:
 * keywords, strings, and comments take the state and label ramps instead of
 * editor-local hues.
 * @returns the highlight style extension.
 */
export function editorHighlight(): Extension {
  return syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.keyword, tags.moduleKeyword, tags.controlKeyword], color: 'var(--dsw-alias-state-business-primary)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--dsw-alias-state-success-primary)' },
    { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--dsw-alias-state-warn-primary)' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--dsw-alias-label-tertiary)', fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--dsw-alias-link)' },
    { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--dsw-alias-state-warn-label)' },
    { tag: [tags.tagName, tags.attributeName], color: 'var(--dsw-alias-label-primary)' },
    { tag: [tags.propertyName], color: 'var(--dsw-alias-label-primary)' },
    { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--dsw-alias-label-primary)' },
    { tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket], color: 'var(--dsw-alias-label-secondary)' },
    { tag: [tags.heading], color: 'var(--dsw-alias-label-primary)', fontWeight: '600' },
    { tag: [tags.emphasis], fontStyle: 'italic' },
    { tag: [tags.strong], fontWeight: '600' },
    { tag: [tags.monospace], color: 'var(--dsw-alias-label-secondary)' },
    { tag: [tags.link], color: 'var(--dsw-alias-link)', textDecoration: 'underline' },
    { tag: [tags.url], color: 'var(--dsw-alias-link)' },
    { tag: [tags.meta, tags.processingInstruction], color: 'var(--dsw-alias-label-tertiary)' },
    { tag: [tags.invalid], color: 'var(--dsw-alias-state-error-primary)' },
  ]))
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
 * @returns base editing, keymaps, the save binding, the token theme and highlight style, soft line wrapping, and the grammar.
 */
export function createEditorExtensions(onSave: () => void, language?: Extension): Extension[] {
  return [
    basicSetup,
    keymap.of([...defaultKeymap, ...historyKeymap]),
    keymap.of([{ key: 'Mod-s', run: saveCommand(onSave), preventDefault: true }]),
    editorTheme(),
    editorHighlight(),
    EditorView.lineWrapping,
    ...(language === undefined ? [] : [language]),
  ]
}
