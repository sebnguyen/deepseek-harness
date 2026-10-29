import { createRequire } from 'node:module'
import { clientBundle } from '../tsdown.client.ts'

// react-mosaic pulls uuid; its package exports pick the node crypto build when
// the client bundle is CJS, which the browser module table cannot satisfy.
// Alias the package root to the browser ESM build so v4() uses globalThis.crypto.
const require = createRequire(import.meta.url)
const uuidBrowser = require.resolve('uuid/package.json').replace(/package\.json$/, 'dist/esm-browser/index.js')
const base = clientBundle('@deepseek-ai/dsh-client-ui-turbo', ['lib/types/index.js'])

export default (inlineConfig: Parameters<typeof base>[0]) => base(inlineConfig).map(config => ({
  ...config,
  alias: { ...config.alias, uuid: uuidBrowser },
}))
