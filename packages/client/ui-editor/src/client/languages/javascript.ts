/** JavaScript and TypeScript: one grammar, four dialects chosen by suffix. */
import { javascript } from '@codemirror/lang-javascript'
import { extensionOf } from './path.ts'
import type { LanguageContribution } from './registry.ts'
import { shebangInterpreter } from './shebang.ts'

/** Interpreters that run JavaScript or TypeScript sources directly. */
const RUNTIMES = ['node', 'nodejs', 'deno', 'bun']

/** The JavaScript/TypeScript language contribution. */
export const javascriptLanguage: LanguageContribution = {
  id: 'javascript',
  extensions: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'],
  firstLine: (line) => {
    const name = shebangInterpreter(line)
    return name !== undefined && RUNTIMES.includes(name)
  },
  load: (path) => {
    switch (extensionOf(path)) {
      case '.ts':
      case '.mts':
      case '.cts': return javascript({ typescript: true })
      case '.tsx': return javascript({ typescript: true, jsx: true })
      case '.jsx': return javascript({ jsx: true })
      default: return javascript()
    }
  },
}
