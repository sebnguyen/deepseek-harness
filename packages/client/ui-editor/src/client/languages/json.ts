/** JSON, including the comment-carrying `.jsonc` variant. */
import { json } from '@codemirror/lang-json'
import type { LanguageContribution } from './registry.ts'

/** The JSON language contribution. */
export const jsonLanguage: LanguageContribution = {
  id: 'json',
  extensions: ['.json', '.jsonc'],
  load: () => json(),
}
