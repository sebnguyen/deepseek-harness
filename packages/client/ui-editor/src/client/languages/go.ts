/** Go, the language the reference deployment runs gopls for. */
import { go } from '@codemirror/lang-go'
import type { LanguageContribution } from './registry.ts'

/** The Go language contribution. */
export const goLanguage: LanguageContribution = {
  id: 'go',
  extensions: ['.go'],
  load: () => go(),
}
