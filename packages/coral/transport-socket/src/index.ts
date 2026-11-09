import type { Context } from '@deepseek-ai/cordis'
/** TCP socket transport: each endpoint is an accept-side or dialed byte stream. */

import { createServer, connect as dial, type Server, type Socket } from 'node:net'
import {
  type Connection,
  type ConnectionId,
  type EndpointId,
  type HostEndpoint,
  type HostId,
  type Listener,
  type Transport,
  type TransportFrame,
  type TransportId,
} from '@deepseek-ai/dsh-coral'

export interface SocketListener {
  readonly endpoint: HostEndpoint
  close(): Promise<void>
}

class SocketConnection implements Connection {
  readonly id: ConnectionId
  readonly transport: TransportId = 'socket' as TransportId
  readonly host: HostId = 'socket' as HostId
  readonly endpoint: EndpointId
  readonly generation: number

  constructor(endpoint: EndpointId, private readonly socket: Socket, generation = 1) {
    this.endpoint = endpoint
    this.generation = generation
    this.id = `${this.host}/${endpoint}/${generation}` as ConnectionId
  }

  send(frame: TransportFrame): Promise<void> {
    if (this.socket.destroyed) return Promise.reject(new Error('coral: connection is closed'))
    return new Promise((resolve, reject) => {
      this.socket.write(frame, (error) => {
        if (error !== null && error !== undefined) reject(error)
        else resolve()
      })
    })
  }

  get read(): AsyncIterable<TransportFrame> {
    return this.socket as unknown as AsyncIterable<TransportFrame>
  }

  get closed(): boolean {
    return this.socket.destroyed
  }

  dispose(): void {
    this.socket.destroy()
  }
}

/** The socket welcomer: the runtime socket Server plus its accepted links. */
class SocketBoundListener implements Listener {
  readonly transport: TransportId = 'socket' as TransportId
  readonly address: { readonly host: string; readonly port: number }
  private readonly queued: Connection[] = []
  private readonly waiters: Array<(connection: Connection | null) => void> = []
  private closed = false

  constructor(
    address: { readonly host: string; readonly port: number },
    private readonly server: Server,
    private readonly links: Set<SocketConnection>,
    private readonly servers: Set<Server>,
    private readonly sockets: Set<SocketConnection>,
  ) {
    this.address = address
  }

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

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters.splice(0)) waiter(null)
    for (const queued of this.queued.splice(0)) void queued.dispose()
    for (const connection of [...this.links]) connection.dispose()
    this.links.clear()
    this.servers.delete(this.server)
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  detach(socket: SocketConnection): void {
    this.links.delete(socket)
    this.sockets.delete(socket)
  }
}

export class SocketTransport implements Transport {
  readonly id: TransportId = 'socket' as TransportId
  readonly hosting = 'exclusive' as const
  private readonly servers = new Set<Server>()
  private readonly sockets = new Set<SocketConnection>()

  private address(endpoint: HostEndpoint): { host: string; port: number } {
    const url = endpoint.url
    if (url === null) throw new Error('coral: socket endpoint requires a url')
    return { host: url.hostname, port: Number(url.port) }
  }

  async bind(endpoint: HostEndpoint): Promise<Listener> {
    const { host, port } = this.address(endpoint)
    const links = new Set<SocketConnection>()
    const server = createServer(() => {})
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => { server.off('listening', onListening); reject(error) }
      const onListening = (): void => { server.off('error', onError); resolve() }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, host)
    })
    this.servers.add(server)
    const socketAddress = server.address()
    const boundPort = typeof socketAddress === 'object' && socketAddress !== null ? socketAddress.port : port
    const bound = new SocketBoundListener(
      { host, port: boundPort },
      server,
      links,
      this.servers,
      this.sockets,
    )
    server.on('connection', (socket) => {
      const connection = new SocketConnection(endpoint.id, socket)
      this.sockets.add(connection)
      links.add(connection)
      socket.once('close', () => { bound.detach(connection) })
      bound.push(connection)
    })
    return bound
  }

  /** Legacy callback accept surface; new code uses bind().accept(). */
  async accept(endpoint: HostEndpoint, handler: (connection: Connection) => void): Promise<SocketListener> {
    const welcome = await this.bind(endpoint)
    void (async () => {
      for await (const connection of welcome.accept()) {
        try {
          handler(connection)
        } catch {
          /* callback errors are the owner's concern */
        }
      }
    })()
    const { host, port } = welcome.address as { host: string; port: number }
    return {
      endpoint: { ...endpoint, url: new URL(`tcp://${host}:${port}`) },
      close: async () => { await welcome.dispose() },
    }
  }

  async dial(endpoint: HostEndpoint): Promise<Connection> {
    const { host, port } = this.address(endpoint)
    const socket = dial({ host, port })
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    const connection = new SocketConnection(endpoint.id, socket)
    this.sockets.add(connection)
    socket.once('close', () => { this.sockets.delete(connection) })
    return connection
  }

  async dispose(): Promise<void> {
    for (const connection of [...this.sockets]) connection.dispose()
    this.sockets.clear()
    for (const server of [...this.servers]) {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
    this.servers.clear()
  }
}

export const socketTransport = {
  name: 'coral.transport.socket',
  apply(ctx: Context): void {
    const registry = ctx.get('coralTransports', false) as unknown as { register(transport: Transport): { dispose(): void } }
    const transport = new SocketTransport()
    ctx.effect(() => {
      const registration = registry.register(transport)
      return () => registration.dispose()
    })
  },
}
