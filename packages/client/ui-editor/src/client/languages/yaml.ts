/** YAML, in both spellings of the suffix. */
import { yaml } from '@codemirror/lang-yaml'
import type { LanguageContribution } from './registry.ts'

/** The YAML language contribution. */
export const yamlLanguage: LanguageContribution = {
  id: 'yaml',
  extensions: ['.yaml', '.yml'],
  load: () => yaml(),
}
