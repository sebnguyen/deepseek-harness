/** HTML. */
import { html } from '@codemirror/lang-html'
import type { LanguageContribution } from './registry.ts'

/** The HTML language contribution. */
export const htmlLanguage: LanguageContribution = {
  id: 'html',
  extensions: ['.html', '.htm'],
  load: () => html(),
}
