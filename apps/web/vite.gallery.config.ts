import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { clientBuildEnvironmentDefines } from '../../scripts/client-build-environment.ts'

const at = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))
const root = at('./gallery')

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  esbuild: { keepNames: true },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@theme': at('../../packages/client/ui-theme/src/styles'),
      '@deepseek-ai/dsh-client-ui-chat': at('../../packages/client/ui-chat'),
      '@deepseek-ai/dsh-client-ui-tool': at('../../packages/client/ui-tool'),
      '@deepseek-ai/dsh-client-ui-goal': at('../../packages/client/ui-goal'),
      '@deepseek-ai/dsh-client-ui-workflow-run': at('../../packages/client/ui-workflow-run'),
      '@deepseek-ai/dsh-client-ui-conversation': at('../../packages/client/ui-conversation'),
      '@deepseek-ai/dsh-client-ui-renderer': at('../../packages/client/ui-renderer'),
      '@deepseek-ai/dsh-client-test-runtime': at('../../packages/test-support/client-runtime'),
      '@deepseek-ai/dsh-client-locale': at('../../packages/client/locale'),
    },
  },
  define: {
    ...clientBuildEnvironmentDefines(process.env),
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
  build: {
    outDir: at('./dist-gallery'),
    emptyOutDir: true,
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: at('./gallery/index.html'),
      output: { inlineDynamicImports: true },
    },
  },
  server: {
    fs: { allow: [at('../..')] },
  },
})
