import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

/**
 * Focused lane for the vscode web client's packages: every spec under
 * packages/extensions/vscode-* (suffix `*.vscode.spec.ts`) without pulling in
 * the whole-repo inventory. The default lanes' glob already matches these
 * files; here they run alone, on the same paths/decorator transforms the
 * default lane applies.
 */
export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.base.json'] }),
    standardDecoratorPlugin(),
  ],
  test: {
    name: 'vscode',
    execArgv: vitestExecArgv,
    pool: 'forks',
    setupFiles: ['./scripts/test-proxy-environment.ts', './scripts/test-invariants.ts'],
    include: ['packages/extensions/vscode-*/tests/**/*.spec.ts'],
  },
})
