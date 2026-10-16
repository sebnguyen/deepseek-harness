/**
 * The host-side vscode composition registry, the vscode analog of the web's
 * `dsh-client-modules`: scans the host loader for packages declaring
 * `dsh.vscode`, reads each plane's staged `lib/vscode.js` bytes, composes the
 * manifest graph, and serves those bytes at `/vscode/plugin/<id>`. The seat
 * side fetches `/vscode/manifest`, then pulls each row's bundle over the
 * same host webServer — the routes this service installs at mount.
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { parseDshVscode, planeIdOf, type VscodeManifest, type VscodePlane } from './manifest.ts'

const EMPTY: VscodeManifest = Object.freeze({ rev: 'empty', plugins: [] })

/** Content revision, first 12 hex chars of a sha1 — the client-modules shortHash convention. */
function shortHash(input: Buffer | string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

interface PlaneRecord extends VscodePlane {
  /** The staged bundle bytes served at the row's `url`. */
  readonly bytes: Buffer
}

/** The structural slices of the vendored host loader this scan reads. */
interface LoaderEntryLike {
  readonly options?: { readonly name?: unknown }
  readonly disabled?: unknown
  readonly fiber?: unknown
  readonly parent?: { readonly tree?: { readonly ctx?: { readonly baseUrl?: string } } }
}
interface LoaderLike {
  entries(): readonly LoaderEntryLike[]
}

/**
 * The service milestone: `inject: ['loader']` mirrors dsh-client-modules —
 * mounting blocks until the host's vendored Loader exists so the roster
 * scan always has its table. The webServer face is attached when it arrives
 * (like the web carrier, the routes come up with the server they ride).
 */
export class VscodeModulesRegistry extends Service {
  static readonly inject: readonly string[] = ['loader']

  private planes: ReadonlyMap<string, PlaneRecord> = new Map()
  private readonly cache = new Map<string, PlaneRecord | null>()
  private flushQueued = false
  private manifestRouteMounted = false

  constructor(ctx: Context) {
    super(ctx, 'vscodeModules')

    ctx.on('internal/plugin', () => { this.scheduleFlush() })

    const registerRoutes = (webCtx: Context & { webServer: WebServer }): void => {
      if (this.manifestRouteMounted) return
      this.manifestRouteMounted = true
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'prefix',
          path: '/vscode/manifest',
          handler: this.serveManifest,
        }),
        'vscode-modules: manifest route',
      )
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'prefix',
          path: '/vscode/plugin',
          handler: this.servePlane,
        }),
        'vscode-modules: plane route',
      )
    }
    // The registry context injects loader only. ctx.get reads the service
    // store; ctx.inject's callback context is the one allowed to read webServer.
    if (ctx.get('webServer') === undefined) ctx.inject(['webServer'], registerRoutes)
    else registerRoutes(ctx)
    this.flush()
  }

  private scheduleFlush(): void {
    if (this.flushQueued) return
    this.flushQueued = true
    queueMicrotask(() => {
      this.flushQueued = false
      this.flush()
    })
  }

  private warn(message: string): void {
    const logger = (this.ctx as unknown as { logger?: { warn?(m: string): void } }).logger
    logger?.warn?.(message)
  }

  /** Recompose planes from the loader's current entry table. */
  private flush(): void {
    const loader = (this.ctx as unknown as { loader?: LoaderLike }).loader
    const next = new Map<string, PlaneRecord>()
    if (loader !== undefined) {
      for (const entry of loader.entries()) {
        const name = entry.options?.name
        if (typeof name !== 'string') continue
        if (entry.fiber === undefined || entry.disabled === true) continue
        const record = this.examine(name, entry.parent?.tree?.ctx?.baseUrl ?? '')
        if (record !== undefined) next.set(record.id, record)
      }
    }
    for (const id of this.planes.keys()) {
      if (!next.has(id)) this.warn(`vscode-modules: plane ${id} left the roster`)
    }
    this.planes = next
  }

  /**
   * Resolve one loader row to a plane record: read its package.json, gate
   * on the `dsh.vscode` declaration, and cache the decision (positive or
   * negative) per loader name until restart.
   */
  private examine(loaderName: string, baseUrl: string): PlaneRecord | undefined {
    const cached = this.cache.get(loaderName)
    if (cached !== undefined) return cached ?? undefined
    let record: PlaneRecord | null = null
    try {
      const require = createRequire(join(baseUrl === '' ? process.cwd() : baseUrl, 'index.js'))
      const packageJsonPath = require.resolve(`${loaderName}/package.json`)
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: unknown; dsh?: { vscode?: unknown } }
      const pkgName = typeof pkg.name === 'string' ? pkg.name : loaderName
      const decl = parseDshVscode(pkgName, pkg.dsh?.vscode)
      if (decl === undefined || decl.platform !== 'vscode') {
        record = null
      } else {
        let bytes: Buffer | undefined
        try {
          bytes = readFileSync(join(dirname(packageJsonPath), 'lib', 'vscode.js'))
        } catch {
          // Declared but unbuilt: drop the plane loudly, never silently.
          this.warn(`vscode-modules: ${loaderName} declares dsh.vscode but lib/vscode.js is missing — build the vscode face`)
        }
        if (bytes !== undefined) {
          const id = planeIdOf(pkgName)
          record = {
            id,
            name: pkgName,
            rev: shortHash(bytes),
            url: `/vscode/plugin/${id}`,
            inject: [...(decl.inject ?? [])],
            external: [...(decl.external ?? [])],
            immediately: decl.immediately ?? true,
            bytes,
          }
        }
      }
    } catch {
      record = null
    }
    this.cache.set(loaderName, record)
    return record ?? undefined
  }

  /**
   * The live manifest rows a seat composes against (`rev` covers the row set).
   * @returns the composed manifest: content-revisioned plane rows.
   */
  graph(): VscodeManifest {
    if (this.planes.size === 0) return EMPTY
    const plugins = this.rows()
    return { rev: `v1:${shortHash(JSON.stringify(plugins))}`, plugins }
  }

  private rows(): VscodePlane[] {
    return [...this.planes.values()].map(({ bytes: _bytes, ...row }) => row)
  }

  private readonly serveManifest = (_req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(this.graph()))
  }

  private readonly servePlane = (req: IncomingMessage, res: ServerResponse): void => {
    const id = (req.url ?? '').replace(/^\/vscode\/plugin\/?/, '')
    const record = this.planes.get(id)
    if (record === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'no vscode plane composed' }))
      return
    }
    res.writeHead(200, {
      'content-type': 'application/javascript',
      'cache-control': 'public, max-age=31536000, immutable',
    })
    res.end(record.bytes)
  }

  /**
   * Milestone-reserved stage hook (the folder-staging variant the draft
   * superseded with HTTP serving). Remains a resolve-no-op until the
   * file-staging milestone returns; callers compose against `graph()`.
   * @param stateDir - the twin state dir the staged variant would write into.
   */
  stageToSpawn(stateDir: string): Promise<void> {
    void stateDir
    return Promise.resolve()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    vscodeModules: VscodeModulesRegistry
  }
}
