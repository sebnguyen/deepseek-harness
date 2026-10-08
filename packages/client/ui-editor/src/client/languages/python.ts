/** Python, by suffix or by the interpreter on a script's first line. */
import { python } from '@codemirror/lang-python'
import type { LanguageContribution } from './registry.ts'
import { shebangInterpreter } from './shebang.ts'

/** Interpreters that run Python sources. */
const INTERPRETERS = ['python', 'python2', 'python3']

/** The Python language contribution. */
export const pythonLanguage: LanguageContribution = {
  id: 'python',
  extensions: ['.py'],
  firstLine: (line) => {
    const name = shebangInterpreter(line)
    return name !== undefined && INTERPRETERS.includes(name)
  },
  load: () => python(),
}
