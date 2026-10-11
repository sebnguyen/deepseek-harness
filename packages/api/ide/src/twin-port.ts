/**
 * A stable loopback port for each twin dist.
 *
 * The REH-web workbench stores user settings in browser IndexedDB, keyed by
 * origin — a random-port spawn hands every boot a fresh origin and silently
 * throws the user's Settings-UI choices away (`dsh web` restarts forget the
 * twin theme toggle, font size tweaks, everything). Anchoring the port per
 * twin dist keeps the origin stable, so the twin remembers its user across
 * harness restarts. The choice is a per-dist hash seeded inside a
 * harness-owned band, de-collided on a loop, and pinned in `<state>/port` so
 * later boots reuse it exactly.
 * @module @deepseek-ai/dsh-api-ide/twin-port
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

/** First port in the harness-owned band. */
const BAND_BASE = 45961
/** Band width; stays clear of common dev servers and stays loopback. */
const BAND_SIZE = 420

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

/**
 * Pick the stable port for one twin dist: the pinned value when it's still
 * free, else the seeded candidate walked forward past collisions, then
 * persisted for later boots. Returns `null` when the whole band sits
 * occupied — callers fall back to a fresh ephemeral port for the run and
 * lose origin persistence rather than the session.
 * @param stateDir - the twin's state dir (its pin file `port` lives here).
 * @param dist - the twin dist root; feeds the deterministic seed.
 */
export async function pickStablePort(stateDir: string, dist: string): Promise<number | null> {
  const pinFile = join(stateDir, 'port')
  try {
    const pinned = Number.parseInt((await readFile(pinFile, 'utf8')).trim(), 10)
    if (Number.isInteger(pinned) && pinned >= BAND_BASE && pinned < BAND_BASE + BAND_SIZE && await portFree(pinned)) {
      return pinned
    }
  } catch {
    /* no pin yet, or unreadable content: fall through to the seeded scan */
  }
  const start = seededCandidate(dist)
  for (let offset = 0; offset < BAND_SIZE; offset += 1) {
    const port = BAND_BASE + ((start + offset - BAND_BASE) % BAND_SIZE)
    if (await portFree(port)) {
      await writeFile(pinFile, `${port}\n`, 'utf8').catch(() => undefined)
      return port
    }
  }
  return null
}
