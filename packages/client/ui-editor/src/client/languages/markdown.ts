/**
 * Markdown, the one language the tab body also renders as a page.
 *
 * The prose files that carry no suffix — `README`, `LICENSE`, and the rest of
 * the conventional repository documents — are claimed by name.
 */
import { markdown } from '@codemirror/lang-markdown'
import type { LanguageContribution } from './registry.ts'

/** The Markdown language contribution. */
export const markdownLanguage: LanguageContribution = {
  id: 'markdown',
  extensions: ['.md', '.markdown'],
  filenames: ['changelog', 'contributing', 'license', 'readme'],
  load: () => markdown(),
}
