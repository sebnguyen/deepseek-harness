/**
 * The bridge's spawn facts, read once at activation.
 *
 * The spawner (`@deepseek-ai/dsh-api-ide`) writes `bridge.json` next to the
 * twin's `.dsh/exts` directory on every spawn — see
 * `stageVscodeBridgeIdentityBridgeIdentity` in `packages/api/ide/src/twin-theme.ts` — and
 * the extension discovers it relative to its own staging dir.
 * @module @deepseek-ai/dsh-vscode-cordis/config
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VscodeBridgeIdentity } from '@deepseek-ai/dsh-api-ide/types'

/** The basename the spawner uses; mirrored from `api/ide/src/twin-theme.ts`. */
export const TWIN_BRIDGE_IDENTITY_BASENAME = 'bridge.json'

/** Shape assertion failures and read failures both narrow to this class. */
export class BridgeConfigError extends Error {
  constructor(message: string, readonly reason: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BridgeConfigError'
  }
}

/**
 * Validate one bridge.json payload against its public contract.
 * @param value - unknown parsed JSON.
 * @returns the validated identity.
 */
export function parseBridgeIdentity(value: unknown): VscodeBridgeIdentity {
  if (typeof value !== 'object' || value === null) {
    throw new BridgeConfigError('bridge.json must be a JSON object', 'shape-invalid')
  }
  const record = value as Record<string, unknown>
  const str = (key: keyof VscodeBridgeIdentity): string | undefined => {
    const part = record[key]
    return typeof part === 'string' ? part : undefined
  }
  const token = str('token')
  if (token === undefined || token === '') {
    throw new BridgeConfigError('bridge.json: token must be a non-empty string', 'token-missing')
  }
  const workspaceKey = str('workspaceKey')
  if (workspaceKey === undefined || workspaceKey === '') {
    throw new BridgeConfigError('bridge.json: workspaceKey must be a non-empty string', 'workspaceKey-missing')
  }
  // dshOrigin is intentionally not validated as non-empty: in profiles
  // without a web server the spawner writes '', and the extension idles.
  const dshOrigin = str('dshOrigin') ?? ''
  // sessionId is the spawn's bootstrap session seed: optional because bridge
  // files staged before the plane work predate it, and superseded at runtime
  // by `ideBridge/activate` frames.
  const sessionId = str('sessionId')
  return { dshOrigin, token, workspaceKey, ...(sessionId === undefined ? {} : { sessionId }) }
}

/**
 * Where the spawner left bridge.json for an extension staged at
 * `<twin>/.dsh/exts/<name>/`: the `.dsh` root is two levels up.
 * @param extensionDir - vscode's `context.extensionUri.fsPath` for this extension.
 * @returns the bridge.json path.
 */
export function bridgeIdentityPath(extensionDir: string): string {
  return join(extensionDir, '..', '..', TWIN_BRIDGE_IDENTITY_BASENAME)
}

/**
 * Load the spawner's identity file; a missing file or malformed JSON is
 * raised with its cause chained, so the twin's log line names the fault.
 * @param path - the absolute bridge.json path to read.
 * @returns the validated identity.
 */
export async function readBridgeIdentity(path: string): Promise<VscodeBridgeIdentity> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new BridgeConfigError(
      `bridge.json not readable at ${path} — the twin is not staged by this host`,
      'identity-missing',
      { cause: error },
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new BridgeConfigError(`bridge.json is not valid JSON at ${path}`, 'json-invalid', { cause: error })
  }
  return parseBridgeIdentity(parsed)
}
