
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { VscodeManifest } from './manifest.ts'

const EMPTY: VscodeManifest = Object.freeze({ rev: 'empty', plugins: [] })

/**
 * The host-side vscode composition registry: owns the `/vscode/manifest`
 * and `/vscode/plugin` webServer routes and, per spawn (milestone down the
 * mirror note), stages the plane bytes behind the manifest rows. Until the
 * roster scan lands, the composed manifest is the empty graph.
 */
export class VscodeModulesRegistry extends Service {
  static readonly inject: readonly string[] = ['webServer']

  constructor(ctx: Context) {
    super(ctx, 'vscodeModules')

    const registerRoutes = (webCtx: { webServer?: { register(route: unknown): void } }): void => {
      const webServer = webCtx.webServer
      if (webServer === undefined) return
      webServer.register({
        kind: 'prefix',
        path: '/vscode/manifest',
        handler: (_req: IncomingMessage, res: ServerResponse) => this.serveManifest(res),
      })
      webServer.register({
        kind: 'prefix',
        path: '/vscode/plugin',
        handler: (req: IncomingMessage, res: ServerResponse) => this.servePlane(req, res),
      })
    }
    registerRoutes(ctx as unknown as { webServer?: { register(route: unknown): void } })
  }

  private composeManifest(): VscodeManifest {
    return EMPTY
  }

  private serveManifest(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(this.composeManifest()))
  }

  private servePlane(_req: IncomingMessage, res: ServerResponse): void {
    // No plane is composed yet; answer the absence honestly (never a bogus stub body).
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'no vscode plane composed' }))
  }

  graph(): VscodeManifest {
    return this.composeManifest()
  }

  async stageToSpawn(stateDir: string): Promise<void> {
    void stateDir
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    vscodeModules: VscodeModulesRegistry
  }
}
