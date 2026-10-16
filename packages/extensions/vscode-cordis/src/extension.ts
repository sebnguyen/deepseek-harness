/**
 * The vscode-facing entry: read the spawner's identity, build the client
 * seat in an extension-local Cordis Context, and pump the downlink.
 *
 * Everything here is wiring and lifecycle; the carrier adaptations live in
 * `transport.ts`, the pump in `seat.ts`. The seat's default consumer
 * handles `ideBridge/open` frames — file forwarding, the bridge's first
 * concrete contract.
 * @module @deepseek-ai/dsh-vscode-cordis/extension
 */

import { Context } from '@deepseek-ai/cordis'
import type { RpcFetch } from '@deepseek-ai/dsh-client-connection/client'
import * as connectionClient from '@deepseek-ai/dsh-client-connection/client'
import * as gatewayClient from '@deepseek-ai/dsh-api-gateway/client'
import * as typertRegistry from '@deepseek-ai/dsh-typert-registry/client'
import ideRemote from '@deepseek-ai/dsh-api-ide/remote'
import timelineRemote from '@deepseek-ai/dsh-api-timeline/remote'
import lineNotesRemote from '@deepseek-ai/dsh-api-line-notes/remote'
import checkpointRemote from '@deepseek-ai/dsh-checkpoint/remote'
import { fetchVscodePlanes, vscodeModulesResolver } from '@deepseek-ai/dsh-vscode-modules/vscode'
import type {
  IdeBridgeDownlinkFrame,
  IdeBridgeReportRequest,
  IdeBridgeTwinCall,
  VscodeBridgeIdentity,
} from '@deepseek-ai/dsh-api-ide/types'

import { armVscodeTransport, vscodeFetch } from './transport.ts'
import { runSeatLoop, SEAT_EVENT_PREFIX } from './seat.ts'
import { apply as vscodeApi, setFacadeLogger } from './vscode-api.ts'
import { readBridgeIdentity, bridgeIdentityPath, type BridgeConfigError } from './config.ts'

/** The extension's stable vscode id — `publisher.name`; the hello's extensionId. */
export const VSCODE_EXTENSION_ID = 'dsh.do-harness-bridge'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Spawn-scoped bridge facts planes read (`ctx.twinCore.token`). The
     * `sessionId` seed comes from the staged bridge.json and is superseded
     * at runtime by `ideBridge/activate` frames.
     */
    twinCore: { readonly token: string; readonly sessionId?: string }
  }
}

/** Structural vscode surface the seat depends on (so the module stays testable offline). */
export interface VsCodeWorkbenchLike {
  showTextDocument(path: string, options?: { readonly line?: number }): Promise<unknown>
  readonly workspaceRoot: string | null
}

interface BridgeSeat {
  readonly seat: Context
  readonly stop: () => Promise<void>
}

/** The cast boundary for the generated namespace face — mirrors the ClientRemote keyed service map. */
interface IdeasSeatRemote {
  ideBridge: {
    report(request: IdeBridgeReportRequest, signal: AbortSignal): Promise<void>
    downlink(request: IdeBridgeTwinCall, signal: AbortSignal): AsyncIterable<unknown>
  }
}

/**
 * Spawn facts → a running seat: hello'd, pumping frames, and stopped on
 * demand. Composed exactly like the web client's minimal seat: registry,
 * connection, gateway plugin; the generated `/remote` catalog mounted;
 * then the seat pump stays until stopped.
 */
export async function spawnBridgeSeat(deps: {
  identity: VscodeBridgeIdentity
  workbench: VsCodeWorkbenchLike
  fetchLike?: RpcFetch
  logger?: (...args: unknown[]) => void
}): Promise<BridgeSeat> {
  const { identity } = deps
  const unarm = armVscodeTransport(identity)

  // The connection plugin's own carrier hook: `createWebConnectionRpc`'s
  // default fetch has no notion `of` the twin token — this page-global
  // makes the injected fetch the carrier, and marks the page privileged
  // (extension processes have no equivalent of a general web audience).
  const transport = {
    fetch: vscodeFetch(identity, deps.fetchLike),
    ownsHost: true,
  }
  const globalCarrier = globalThis as { __DSH_TRANSPORT__?: unknown }
  const prior = globalCarrier.__DSH_TRANSPORT__
  globalCarrier.__DSH_TRANSPORT__ = transport

  const seat = new Context()
  seat.twinCore = Object.freeze({
    token: identity.token,
    ...(identity.sessionId === undefined ? {} : { sessionId: identity.sessionId }),
  })
  const restore = (): void => {
    if (prior === undefined) delete globalCarrier.__DSH_TRANSPORT__
    else globalCarrier.__DSH_TRANSPORT__ = prior
    unarm()
  }
  try {
    await seat.plugin({ name: 'typert/registry', inject: [] as string[], apply: typertRegistry.apply })
    await seat.plugin({ name: 'connection', inject: [] as string[], apply: connectionClient.apply })
    await seat.plugin({ name: 'gateway', inject: ['typert', 'connection'], apply: gatewayClient.apply })
    setFacadeLogger(deps.logger)
    // The vscode facade is a cordis plugin like everything else on the seat:
    // planes may then name `vscodeApi` — and the gateway-provided
    // `remote.<namespace>` services — in their inject lists, and cordis's
    // inject gate resolves both by service name rather than by attribute
    // luck. The vendored Loader stays unmounted: its `isolate` plugin scopes
    // fibers so these services never resolve for them.
    await seat.plugin({ name: 'vscodeApi', apply: vscodeApi })
    const remote = seat.remote

    const unload = await remote.$mount(ideRemote)
    const unloadTimeline = await remote.$mount(timelineRemote)
    const unloadLineNotes = await remote.$mount(lineNotesRemote)
    // Plugin 6's substrate: the checkpoint slot register reaches the seat so
    // the timeline/notes planes read blobs and slot projections directly.
    const unloadCheckpoint = await remote.$mount(checkpointRemote)
    const { ideBridge } = remote as unknown as IdeasSeatRemote

    // The seat's plane layer: fetch the host's vscode manifest and mount one
    // named plugin per row. Each plane declares its own inject list —
    // `vscodeApi` and the `remote.<namespace>` services the gateway installs
    // via `$mount` — and the injector entitles the fiber to read exactly
    // those, which is the composition every other cordis plugin on this seat
    // already uses. A host without the vscode-modules registry answers no
    // manifest, and the seat stays bridge-only by design. A single
    // misbehaving row never strands its siblings — it is logged and skipped.
    try {
      const graph = await fetchVscodePlanes(identity.dshOrigin)
      deps.logger?.(`vscode seat: manifest ${graph.rev} — composing ${graph.plugins.length} plane(s)`)
      const resolver = vscodeModulesResolver({ dshOrigin: identity.dshOrigin }, graph)
      for (const row of graph.plugins) {
        try {
          const resolved = (await resolver(row.id)) as { apply?: (ctx: Context) => void | Promise<void> }
          if (typeof resolved.apply !== 'function') {
            throw new Error(`plane ${row.id} resolves without an apply function`)
          }
          await seat.plugin({ name: row.id, ...(row.inject.length > 0 ? { inject: [...row.inject] } : {}), apply: resolved.apply })
          deps.logger?.(`vscode seat: plane ${row.id} mounted`)
        } catch (error) {
          deps.logger?.(`vscode seat: plane ${row.id} failed to mount; continuing without it`, error)
        }
      }
    } catch (error) {
      deps.logger?.('vscode seat: no plane manifest available; running bridge-only', error)
    }

    const abort = new AbortController()
    const openHandler = (frame: unknown): void => {
      if (!isOpenFrame(frame)) return
      void deps.workbench.showTextDocument(frame.path, {
        ...(frame.line === undefined ? {} : { line: frame.line }),
      }).then(() => {
        deps.logger?.(`ideBridge/open consumed: ${frame.path}`)
      }, (error: unknown) => {
        // An open failure must never die as an unobserved rejection: the host
        // forwarded this path as authoritative, and a silent drop is the
        // "click, nothing happens" ghost the user cannot report.
        deps.logger?.('ideBridge/open failed for %s:', frame.path, error)
      })
    }
    // Dynamic seat-local frame events live outside any declared Events map;
    // the plain cordis emitter API is reached through this escape hatch, the
    // same one `runSeatLoop`'s `emit` uses at the publisher side.
    const local = seat as unknown as {
      on(event: string, listener: (arg: unknown) => void): unknown
      emit(event: string, ...args: unknown[]): unknown
    }
    local.on(`${SEAT_EVENT_PREFIX}ideBridge/open`, openHandler)

    const seatRemote = {
      report: (request: IdeBridgeReportRequest) => ideBridge.report(request, abort.signal),
      downlink: (request: IdeBridgeTwinCall, signal: AbortSignal) => ideBridge.downlink(request, signal),
    }
    const pump = runSeatLoop({
      remote: seatRemote,
      identity: {
        token: identity.token,
        hello: {
          extensionId: VSCODE_EXTENSION_ID,
          version: '0.1.0',
          workspaceRoot: deps.workbench.workspaceRoot,
        },
      },
      signal: abort.signal,
      emit: (name, frame) => { local.emit(name, frame) },
      logger: (message, error) => { deps.logger?.(message, error) },
    })

    return {
      seat,
      stop: async () => {
        abort.abort()
        await pump.catch(() => undefined)
        await unload()
        await unloadTimeline()
        await unloadLineNotes()
        await unloadCheckpoint()
        await seat.fiber.dispose().catch(() => undefined)
        restore()
      },
    }
  } catch (error) {
    await seat.fiber.dispose().catch(() => undefined)
    restore()
    throw error
  }
}

type OpenFrame = Extract<IdeBridgeDownlinkFrame, { readonly type: 'ideBridge/open' }>

function isOpenFrame(frame: unknown): frame is OpenFrame {
  return typeof frame === 'object' && frame !== null
    && (frame as { type?: unknown }).type === 'ideBridge/open'
    && typeof (frame as { path?: unknown }).path === 'string'
}

/**
 * vscode extension activation: read bridge.json beside the staged
 * extension and spin the seat. A missing file or empty origin says the
 * twin wasn't staged by this host — the seat stays asleep.
 */
export async function activate(context: {
  readonly extensionUriFsPath: string
  readonly workbench: VsCodeWorkbenchLike
  readonly logger?: (...args: unknown[]) => void
}): Promise<{ stop: () => Promise<void> }> {
  const identity = await readBridgeIdentity(bridgeIdentityPath(context.extensionUriFsPath))
  if (identity.dshOrigin === '') {
    throw Object.assign(new Error('bridge.json carries no dshOrigin — this twin has no bridge seat'), {
      name: 'BridgeConfigError' satisfies BridgeConfigError['name'],
    })
  }
  return spawnBridgeSeat({ identity, workbench: context.workbench, ...(context.logger === undefined ? {} : { logger: context.logger }) })
}
