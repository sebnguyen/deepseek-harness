import type { Context } from '@deepseek-ai/cordis'
/** In-process queue-pair transport: one heap, no OS pipe, no process isolation. */

import {
  type ConnectionId,
  type Disposable,
  type TransportId,
  type Connection,
  type EndpointId,
  type HostEndpoint,
  type HostId,
  type Listener,
  type Transport,
  type TransportFrame,
} from '@deepseek-ai/dsh-coral'

interface Waiter {
  readonly resolve: (result: IteratorResult<TransportFrame>) => void
  readonly reject: (error: Error) => void
}

class FrameQueue {
  private readonly frames: TransportFrame[] = []
  private readonly readers: Waiter[] = []
  private readonly writers: Array<() => void> = []
  private closed = false

  constructor(private readonly limit: number) {}

  get isClosed(): boolean {
    return this.closed
  }

  async push(frame: TransportFrame): Promise<void> {
    if (this.closed) throw new Error('coral: connection is closed')
    if (this.frames.length >= this.limit) {
      await new Promise<void>((resolve) => { this.writers.push(resolve) })
      if (this.closed) throw new Error('coral: connection is closed')
    }
    if (this.closed) throw new Error('coral: connection is closed')
    const reader = this.readers.shift()
    if (reader === undefined) this.frames.push(frame)
    else reader.resolve({ value: frame, done: false })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const reader of this.readers.splice(0)) reader.resolve({ value: undefined, done: true })
    for (const writer of this.writers.splice(0)) writer()
  }

  private wakeWriter(): void {
    this.writers.shift()?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<TransportFrame> {
    for (;;) {
      const frame = this.frames.shift()
      if (frame !== undefined) {
        this.wakeWriter()
        yield frame
        continue
      }
      if (this.closed) return
      const result = await new Promise<IteratorResult<TransportFrame>>((resolve, reject) => {
        this.readers.push({ resolve, reject })
      })
      if (result.done === true) return
      yield result.value
    }
  }
}

export interface EndpointRef {
  readonly host: HostId
  readonly endpoint: HostEndpoint
}

class InprocConnection implements Connection {
  readonly id: ConnectionId
  readonly transport: TransportId = 'inproc' as TransportId

  constructor(
    readonly host: HostId,
    readonly endpoint: EndpointId,
    readonly generation: number,
    private readonly inbox: FrameQueue,
    private readonly outbox: FrameQueue,
  ) {
    this.id = `${host}/${endpoint}/${generation}` as ConnectionId
  }

  send(frame: TransportFrame): Promise<void> {
    return this.outbox.push(frame)
  }

  get read(): AsyncIterable<TransportFrame> {
    return this.inbox
  }

  get closed(): boolean {
    return this.outbox.isClosed
  }

  dispose(): void {
    this.inbox.close()
    this.outbox.close()
  }
}

/** The inproc welcomer: claim on one endpoint id, N accepted links over time. */
export class InprocBoundListener implements Listener {
  readonly transport: TransportId = 'inproc' as TransportId
  readonly address: unknown = null
  private readonly queued: Connection[] = []
  private readonly waiters: Array<(connection: Connection | null) => void> = []
  private closed = false

  constructor(
    private readonly endpoint: EndpointId,
    private readonly owner: Map<EndpointId, InprocBoundListener>,
  ) {}

  push(connection: Connection): void {
    if (this.closed) {
      void connection.dispose()
      return
    }
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.queued.push(connection)
    else waiter(connection)
  }

  async *accept(): AsyncIterable<Connection> {
    for (;;) {
      const next = this.queued.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      if (this.closed) return
      const incoming = await new Promise<Connection | null>((resolve) => { this.waiters.push(resolve) })
      if (incoming === null) return
      yield incoming
    }
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.owner.delete(this.endpoint)
    for (const waiter of this.waiters.splice(0)) waiter(null)
    for (const queued of this.queued.splice(0)) void queued.dispose()
  }
}

export class InprocTransport implements Transport {
  readonly id: TransportId = 'inproc' as TransportId
  readonly hosting = 'shared' as const
  private readonly pending = new Map<EndpointId, Connection>()
  private readonly bound = new Map<EndpointId, InprocBoundListener>()
  private readonly callbacks = new Map<EndpointId, (connection: Connection) => void>()

  constructor(private readonly limit = 64) {}

  pair(a: EndpointRef, b: EndpointRef): readonly [Connection, Connection] {
    const ab = new FrameQueue(this.limit)
    const ba = new FrameQueue(this.limit)
    const first = new InprocConnection(a.host, a.endpoint.id, 1, ba, ab)
    const second = new InprocConnection(b.host, b.endpoint.id, 1, ab, ba)
    this.pending.set(a.endpoint.id, first)
    this.pending.set(b.endpoint.id, second)
    return [first, second]
  }

  bind(endpoint: HostEndpoint): Listener {
    const existing = this.bound.get(endpoint.id)
    if (existing !== undefined) return existing
    const welcome = new InprocBoundListener(endpoint.id, this.bound)
    this.bound.set(endpoint.id, welcome)
    return welcome
  }

  /** Legacy callback listen surface; new code uses bind().accept(). */
  listen(ref: EndpointRef, handler: (connection: Connection) => void): Disposable {
    this.callbacks.set(ref.endpoint.id, handler)
    return {
      dispose: () => { this.callbacks.delete(ref.endpoint.id) },
    }
  }

  async dial(endpoint: HostEndpoint): Promise<Connection> {
    const pending = this.pending.get(endpoint.id)
    if (pending !== undefined) {
      this.pending.delete(endpoint.id)
      return pending
    }
    const welcome = this.bound.get(endpoint.id)
    const legacy = this.callbacks.get(endpoint.id)
    if (welcome === undefined && legacy === undefined) {
      throw new Error(`coral: no inproc listener or pair for endpoint ${endpoint.id}`)
    }
    const ab = new FrameQueue(this.limit)
    const ba = new FrameQueue(this.limit)
    const client = new InprocConnection('client' as HostId, endpoint.id, 1, ba, ab)
    const server = new InprocConnection('inproc' as HostId, endpoint.id, 1, ab, ba)
    if (welcome !== undefined) welcome.push(server)
    else legacy?.(server)
    return client
  }

  async dispose(): Promise<void> {
    for (const connection of this.pending.values()) await connection.dispose()
    this.pending.clear()
    for (const welcome of [...this.bound.values()]) welcome.dispose()
    this.bound.clear()
    this.callbacks.clear()
  }
}

export const inprocTransport = {
  name: 'coral.transport.inproc',
  apply(ctx: Context): void {
    const registry = ctx.get('coralTransports', false) as unknown as { register(transport: Transport): { dispose(): void } }
    const transport = new InprocTransport()
    ctx.effect(() => {
      const registration = registry.register(transport)
      return () => registration.dispose()
    })
  },
}
