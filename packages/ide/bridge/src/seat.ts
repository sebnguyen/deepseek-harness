/**
 * The seat assembly: a third cordis engine mounted inside the twin's
 * extension host, built from the same client halves the served web app
 * uses — typert registry, api-gateway client, and the generated `ide` and
 * `checkpoint` remote bundles — with the injected-fetch carrier as its only
 * non-browser accommodation. The spawn env is the seat's evidence row:
 * gateway url plus the per-launch token prove parentage, so activation
 * provides nothing and mounts nothing without them. Unary verbs work
 * immediately; the Remote event and stream downlinks wait for a Node
 * WebSocket leg and the generations therefore stay quiet for now.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import * as gatewayClient from '@deepseek-ai/dsh-api-gateway/client'
import { createWebConnectionRpc } from '@deepseek-ai/dsh-client-connection/src/client/rpc.ts'
import type {
  ClientConnectionRpc,
  ConnectionGeneration,
  ConnectionHandle,
  ConnectionSinks,
  ConnectionState,
  RpcFetch,
} from '@deepseek-ai/dsh-client-connection/client'
import * as registryClient from '@deepseek-ai/dsh-typert-registry/client'
import checkpointRemote from '@deepseek-ai/dsh-checkpoint/remote'
import ideRemote from '@deepseek-ai/dsh-host-ide/remote'

/** Evidence the ext-host runs as the Host's own child. */
export interface SeatEvidence {
  /** The Host loopback gateway base, as forwarded in the spawn env. */
  readonly gatewayUrl: string
  /** The process launch token the spawn env names `DSH_IDE_TOKEN`. */
  readonly token: string
  /** The session the seat addresses for checkpoint projections. */
  readonly sessionId: string
}

/** Read the seat evidence from a spawn environment; absent facts mean stay dark. */
export function seatEvidence(env: Readonly<Record<string, string | undefined>>): SeatEvidence | undefined {
  const gatewayUrl = env.DSH_GATEWAY_URL
  const token = env.DSH_IDE_TOKEN
  const sessionId = env.DSH_SESSION_ID
  if (gatewayUrl === undefined || gatewayUrl === '' || token === undefined || token === ''
    || sessionId === undefined || sessionId === '') return undefined
  return { gatewayUrl: gatewayUrl.replace(/\/$/u, ''), token, sessionId }
}

/**
 * The entire non-browser accommodation: the carrier hands over the house
 * URL it would have dialed, and the adapter re-anchors it to the gateway
 * base with the launch token as the browser-auth query leg.
 * @param evidence - gateway base and launch token.
 * @returns a fetch with the same signature as the global one.
 */
export function seatFetch(evidence: SeatEvidence): RpcFetch {
  return (input, init) => {
    const url = new URL(input)
    url.search = `token=${encodeURIComponent(evidence.token)}`
    return fetch(new URL(url.pathname + url.search, evidence.gatewayUrl), init)
  }
}

interface Observer {
  (listener: () => void): () => void
}

function observable(value: { current: unknown }): { getSnapshot: () => unknown; subscribe: Observer } {
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value.current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * A minimal Host-side carrier handle: the rpc closures ride the injected
 * fetch, liveness loops the generation source by hand with plain backoff,
 * and `open` answers the forwarded-event stream with one synthetic ready
 * frame then pend — the WS multiplex leg arrives with the Node WebSocket
 * adapter, until then the event downlink is quiet and unary verbs live.
 * @param rpc - the token-closured caller.
 * @returns the `connection` key payload for the seat context.
 */
export function seatConnection(rpc: ClientConnectionRpc): ConnectionHandle {
  const generation = { current: undefined as ConnectionGeneration | undefined }
  const state = { current: undefined as ConnectionState | undefined }
  const generationStore = observable(generation)
  const stateStore = observable(state)
  let source: ((signal: AbortSignal, ready: (host: { home: string }) => void) => Promise<void>) | undefined
  let owner: { abort: AbortController; stop: boolean } | undefined
  let generationId = 0
  const publish = (store: { current: unknown }, next: unknown): void => {
    store.current = next
  }
  const run = (sinks: ConnectionSinks): { abort: AbortController; stop: boolean } => {
    const current = source
    if (current === undefined) throw new Error('seat: no generation source is registered')
    const holder = { abort: new AbortController(), stop: false }
    owner = holder
    void (async () => {
      let attempt = 0
      while (!holder.stop) {
        publish(state, attempt === 0 ? undefined : 'connecting')
        try {
          await current(holder.abort.signal, (host) => {
            generationId += 1
            publish(generation, { id: generationId, host })
            publish(state, 'connected')
            sinks.onConnected?.(host)
          })
        }
        catch {
          /* the generation ended; fall through to the backoff below */
        }
        if (holder.stop) break
        publish(generation, undefined)
        publish(state, 'disconnected')
        sinks.onStateChange?.('disconnected')
        attempt += 1
        const cap = Math.min(15_000, 500 * 2 ** Math.min(5, attempt - 1))
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, cap / 2 + Math.random() * (cap / 2))
          holder.abort.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolve()
          }, { once: true })
        })
      }
    })()
    return holder
  }
  const withOpen: ClientConnectionRpc = {
    call: (channel, endpoint, payload, signal) => rpc.call(channel, endpoint, payload, signal),
    open: (channel, endpoint, payload, signal) => {
      if (channel !== '/api') throw new Error(`seat: worker-local streams require /api, got ${JSON.stringify(channel)}`)
      void payload
      return eventDownlink(endpoint, signal)
    },
  }
  return {
    isLoopback: true,
    generation: {
      getSnapshot: () => generationStore.getSnapshot() as ConnectionGeneration | undefined,
      subscribe: generationStore.subscribe,
    },
    state: {
      getSnapshot: () => stateStore.getSnapshot() as ConnectionState | undefined,
      subscribe: stateStore.subscribe,
    },
    rpc: withOpen,
    reconnect: () => {
      owner?.abort.abort(new Error('seat: manual reconnect'))
    },
    registerGenerationSource: (next) => {
      if (source !== undefined) throw new Error('seat: a generation source is already registered')
      source = next
      return () => {
        source = undefined
        owner?.abort.abort(new Error('seat: generation source withdrawn'))
      }
    },
    start: (sinks) => {
      if (owner !== undefined) throw new Error('seat: the connection loop is already owned')
      const holder = run(sinks)
      return {
        stop: () => {
          holder.stop = true
          holder.abort.abort(new Error('seat: connection loop stopped'))
        },
      }
    },
  }
}

/**
 * The forwarded-event downlink without a WebSocket leg: one synthetic
 * ready frame so the generation establishes, then pend until the caller
 * aborts. Host-to-client event deliveries arrive once a physical mux
 * adapter lands; nothing else about the client halves notices.
 * @param endpoint - the gateway-internal event endpoint being opened.
 * @param signal - generation cancellation.
 * @returns the quiet stream.
 */
export async function* eventDownlink(endpoint: string, signal: AbortSignal): AsyncGenerator<unknown> {
  void endpoint
  yield { type: 'ready', clientId: 'seat-events', host: { home: '' } }
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

/** The mounted generated halves the seat's features consume. */
export const SEAT_REMOTES = [
  ideRemote,
  checkpointRemote,
] as const

/** Seat plugin mounting the generated client bundles, mirroring the web remotes assembly. */
export const mountRemotes = {
  inject: ['remote'],
  async apply(ctx: Context): Promise<() => Promise<void>> {
    const disposers: Array<() => Promise<void>> = []
    try {
      for (const contribution of SEAT_REMOTES) {
        disposers.push(await ctx.remote.$mount(contribution))
      }
    }
    catch (error) {
      for (const dispose of disposers.reverse()) await dispose()
      throw error
    }
    return async () => {
      for (const dispose of disposers.reverse()) await dispose()
    }
  },
}

/** The live seat: its cordis engine, the carrier, and the teardown order. */
export interface Seat {
  /** The seat's own engine instance; features mount into it. */
  readonly context: Context
  /** The token-closured caller for glue that predates key gates. */
  readonly rpc: ClientConnectionRpc
  /** Tear the engine and its fiber down in reverse activation order. */
  dispose(): Promise<void>
}

/**
 * Start the seat engine when the evidence row proves parentage; without it
 * the twin is a stock editor and nothing of the house mounts.
 * @param evidence - the spawn-env facts.
 * @returns the running seat.
 */
export async function startSeat(evidence: SeatEvidence): Promise<Seat> {
  const rpc = createWebConnectionRpc(seatFetch(evidence))
  const context = new CordisContext()
  context.provide('connection', seatConnection(rpc))
  await context.plugin(registryClient)
  await context.plugin(gatewayClient)
  await context.plugin(mountRemotes)
  return {
    context,
    rpc,
    dispose: () => context.fiber.dispose(),
  }
}
