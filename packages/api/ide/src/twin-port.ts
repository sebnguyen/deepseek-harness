/**
 * A stable loopback port for each twin dist.
 *
 * The REH-web workbench stores user settings in browser IndexedDB, keyed by
 * origin — a random-port spawn hands every boot a fresh origin and silently
 * throws the user's Settings-UI choices away (`dsh web` restarts forget the
 * twin theme toggle, font size tweaks, everything). Anchoring the port per
 * twin keeps the origin stable, so the twin remembers its user across
 * harness restarts. The choice is a per-dist hash seeded inside a
 * harness-owned band, de-collided on a loop, and pinned in `<state>/port` so
 * later boots reuse it exactly — `<state>` is one workspace twin's private
 * state slot, so sibling twins probe the same band and skip occupied pins.
 * @module @deepseek-ai/dsh-api-ide/twin-port
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

/** First port in the harness-owned band. */
const BAND_BASE = 45961
/** Band width; stays clear of common dev servers and stays loopback. */
const BAND_SIZE = 420

/** Basename of the pin file inside one twin's state slot; exported for the spawner's legacy-pin adoption. */
export const TWIN_PORT_PIN_BASENAME = 'port'

/** True when the port is bindable on loopback right now. */
const portFree = async (port: number): Promise<boolean> =>
  await new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true))
    })
  })

/** Deterministic first candidate for this dist path inside the band. */
function seededCandidate(dist: string): number {
  const hash = createHash('sha1').update(dist).digest().readUInt32BE(0)
  return BAND_BASE + (hash % BAND_SIZE)
}

/** Synchronously read a pinned port; undefined when absent or invalid. */
function readPortPin(pinFile: string): number | undefined {
  try {
    const pinned = Number.parseInt(readFileSync(pinFile, 'utf8').trim(), 10)
    if (Number.isInteger(pinned) && pinned >= BAND_BASE && pinned < BAND_BASE + BAND_SIZE) return pinned
  } catch {
    /* no pin yet */
  }
  return undefined
}

/**
 * Pick the stable port for one twin dist: the pinned value when it's still
 * free, else the seeded candidate walked forward past collisions, then
 * persisted for later boots. Returns `null` when the whole band sits
 * occupied — callers fall back to a fresh ephemeral port for the run and
 * lose origin persistence rather than the session.
 *
 * The pin write is synchronous and verified by re-reading; a failure to
 * persist propagates instead of silently degrading, so a parked iframe
 * never rides a port that was never actually pinned.
 * @param stateDir - the twin's state dir (its pin file `port` lives here).
 * @param dist - the twin dist root; feeds the deterministic seed.
 */
export async function pickStablePort(stateDir: string, dist: string): Promise<number | null> {
  const pinFile = join(stateDir, TWIN_PORT_PIN_BASENAME)
  const pinned = readPortPin(pinFile)
  if (pinned !== undefined && (await portFree(pinned))) {
    return pinned
  }
  const start = seededCandidate(dist)
  for (let offset = 0; offset < BAND_SIZE; offset += 1) {
    const port = BAND_BASE + ((start + offset - BAND_BASE) % BAND_SIZE)
    if (await portFree(port)) {
      writeFileSync(pinFile, `${port}\n`, 'utf8')
      if (Number.parseInt(readFileSync(pinFile, 'utf8').trim(), 10) !== port) {
        throw new Error(`ide: twin port pin did not persist (${pinFile})`)
      }
      return port
    }
  }
  return null
}
