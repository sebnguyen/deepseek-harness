/**
 * The language set this editor ships: one module per language, registered into
 * one registry.
 *
 * A language is a static import, so the single-file client bundle needs no
 * chunking, and adding one touches nothing else — the tab body asks the
 * registry for whatever the opened path resolves to. Interpreter lines are
 * tested in the order listed below.
 */
import { cssLanguage } from './css.ts'
import { goLanguage } from './go.ts'
import { htmlLanguage } from './html.ts'
import { javascriptLanguage } from './javascript.ts'
import { jsonLanguage } from './json.ts'
import { markdownLanguage } from './markdown.ts'
import { pythonLanguage } from './python.ts'
import { LanguageRegistry, type LanguageContribution } from './registry.ts'
import { rustLanguage } from './rust.ts'
import { yamlLanguage } from './yaml.ts'

/** Every language the editor detects, in first-line test order. */
export const BUILTIN_LANGUAGES: readonly LanguageContribution[] = [
  cssLanguage,
  goLanguage,
  htmlLanguage,
  javascriptLanguage,
  jsonLanguage,
  markdownLanguage,
  pythonLanguage,
  rustLanguage,
  yamlLanguage,
]

/**
 * Build the registry the editor detects through.
 * @returns a registry holding every {@link BUILTIN_LANGUAGES} contribution.
 */
export function createLanguageRegistry(): LanguageRegistry {
  const registry = new LanguageRegistry()
  for (const language of BUILTIN_LANGUAGES) registry.register(language)
  return registry
}
