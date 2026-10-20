/**
 * A stable connection token per workspace twin.
 *
 * The connection token is the client-visible identity of a twin: it gates
 * the downlink/report remotes and rides the iframe URL as `?tkn=`. Minting
 * it per spawn means every respawn rotates the secret out from under every
 * parked iframe, and the stranded workbench's reconnects die as repeated
 * "auth mismatch" ghosts. Anchor the token per workspace the way
 * {@link pickStablePort} anchors the port per dist: pinned in
 * `<state>/twin-token.<sha1(workspaceKey)>` so a respawned twin reissues
 * the same `--connection-token` and reconnecting clients ride the
 * workbench's reconnection grace instead of re-credentialling. The pin
 * lives in the twin's private state slot (see {@link twinStateDirName});
 * older layouts pinned one file per workspace under the SHARED `.dsh`
 * root, and the spawner migrates those pins into the slot on first use.
 * @module @deepseek-ai/dsh-api-ide/twin-token
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Base64url shape the spawner issues: 24 random bytes render as 32 chars. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/

/** The sha1 hex of one workspace key: the digest every per-workspace name shares. */
function workspaceKeyDigest(workspaceKey: string): string {
  return createHash('sha1').update(workspaceKey).digest('hex')
}

/**
 * The basename of one workspace twin's private state slot under `.dsh`.
 *
 * Each workspace's twin gets its OWN state dir — `.dsh/twin.<sha1>` —
 * because the spawner stages per-twin files there (`bridge.json`, the
 * `--connection-token` identity every parked iframe and the seat's
 * downlink loyalty both hinge on). A single shared state dir handed the
 * last-spawned twin's identity to every sibling twin that re-read its
 * `bridge.json`, and two live twins then tug-of-war'ed one downlink
 * through supersession while the other workspace's frames drained into
 * the wrong editor — "frames silently lost".
 * Exported for the host specs; production callers read through the
 * spawner only.
 */
export function twinStateDirName(workspaceKey: string): string {
  return `twin.${workspaceKeyDigest(workspaceKey)}`
}

/**
 * The pin file basename for one workspace, hashed from its workspaceKey.
 * The name stays workspace-hashed even inside the per-workspace state
 * slot, so a slot moved between layouts still self-describes the key it
 * serves. Exported for the host specs; production callers read through
 * {@link stableTwinToken} only.
 */
export function twinTokenPinName(workspaceKey: string): string {
  return `twin-token.${workspaceKeyDigest(workspaceKey)}`
}

/**
 * The stable token for one workspace twin: the pinned value when a live pin
 * exists, else a freshly minted token persisted for later respawns. A
 * corrupt pin is treated as absent and overwritten with the replacement,
 * and a failed pin write degrades to a per-spawn token (this boot's
 * behavior) rather than failing the spawn.
 * @param stateDir - the twin's own state slot (see {@link twinStateDirName}).
 * @param workspaceKey - the twin's workspace key the token is pinned to.
 * @returns the connection token to pass as `--connection-token`.
 */
export async function stableTwinToken(stateDir: string, workspaceKey: string): Promise<string> {
  const pinFile = join(stateDir, twinTokenPinName(workspaceKey))
  try {
    const pinned = (await readFile(pinFile, 'utf8')).trim()
    if (TOKEN_PATTERN.test(pinned)) return pinned
  } catch {
    /* no pin yet, or unreadable content: mint below */
  }
  const token = randomBytes(24).toString('base64url')
  await writeFile(pinFile, `${token}\n`, 'utf8').catch(() => undefined)
  return token
}
