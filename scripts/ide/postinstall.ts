/**
 * Best-effort twin fetch on `pnpm install`: developers with a network land the
 * frame they did not have to build; hermetic CI, offline machines, and any
 * refusal (unrecorded platform, unreachable release) print one line and leave
 * the frame-absent posture, which is not an error. Opt out with
 * DSH_IDE_NO_FETCH=1 or CI=1.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultReleaseBase, fetchTwin, type FetchRow } from './fetch.ts'

void (async () => {
  if (process.env.DSH_IDE_NO_FETCH !== undefined || process.env.CI !== undefined) return
  try {
    const row = JSON.parse(await readFile(join(import.meta.dirname, 'manifest.default.json'), 'utf8')) as FetchRow
    const platformKey = process.env.DSH_IDE_BUILD_PLATFORM ?? `${process.platform}-${process.arch}`
    const cacheDir = process.env.DSH_IDE_CACHE_DIR ?? join(process.env.HOME ?? '/tmp', '.cache', 'dsh', 'ide')
    const fetched = await fetchTwin({
      row,
      platformKey,
      base: defaultReleaseBase(row.upstreamSha),
      twinDir: join(cacheDir, row.upstreamSha, platformKey),
    })
    console.log(fetched ? `ide: twin ready (${platformKey})` : `ide: twin already current (${platformKey})`)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`ide: twin not fetched (frame falls back to the editor lane): ${message}`)
  }
})()
