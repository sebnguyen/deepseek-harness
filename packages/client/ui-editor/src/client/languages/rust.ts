/** Rust, the other language the reference deployment configures a server for. */
import { rust } from '@codemirror/lang-rust'
import type { LanguageContribution } from './registry.ts'

/** The Rust language contribution. */
export const rustLanguage: LanguageContribution = {
  id: 'rust',
  extensions: ['.rs'],
  load: () => rust(),
}
