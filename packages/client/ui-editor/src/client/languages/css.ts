/** CSS. */
import { css } from '@codemirror/lang-css'
import type { LanguageContribution } from './registry.ts'

/** The CSS language contribution. */
export const cssLanguage: LanguageContribution = {
  id: 'css',
  extensions: ['.css'],
  load: () => css(),
}
