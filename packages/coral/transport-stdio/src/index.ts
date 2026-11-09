import type { Context } from '@deepseek-ai/cordis'
/** Stdio transport: the peer is a child process; its stdin/stdout carry frames. */

import { spawn, type ChildProcess } from 'node:child_process'
import {
  type Connection,
  type ConnectionId,
  type EndpointId,
  type HostEndpoint,
  type HostId,
  type Transport,
  type TransportFrame,
  type TransportId,
} from '@deepseek-ai/dsh-coral'

export interface StdioMeta {
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
}

class StdioConnection implements Connection {
  readonly id: ConnectionId
  readonly transport: TransportId = 'stdio' as TransportId
  readonly host: HostId = 'stdio' as HostId
  readonly endpoint: EndpointId
  readonly generation: number

  constructor(endpoint: EndpointId, private readonly child: ChildProcess, generation = 1) {
    this.endpoint = endpoint
    this.generation = generation
    this.id = `${this.host}/${endpoint}/${generation}` as ConnectionId
  }

  send(frame: TransportFrame): Promise<void> {
    const input = this.child.stdin
    if (input === null || input.destroyed) {
      return Promise.reject(new Error('coral: connection is closed'))
    }
    return new Promise((resolve, reject) => {
      input.write(frame, (error) => {
        if (error !== null && error !== undefined) reject(error)
        else resolve()
      })
    })
  }

  get read(): AsyncIterable<TransportFrame> {
    const output = this.child.stdout
    if (output === null) throw new Error('coral: stdio child has no stdout')
    return output
  }

  get closed(): boolean {
    return this.child.exitCode !== null || this.child.signalCode !== null
  }

  dispose(): void {
    this.child.stdin?.end()
    this.child.kill()
  }
}

export class StdioTransport implements Transport {
  readonly id: TransportId = 'stdio' as TransportId
  readonly hosting = 'shared' as const
  private readonly children = new Set<ChildProcess>()

  async dial(endpoint: HostEndpoint): Promise<Connection> {
    const meta = endpoint.meta as StdioMeta | undefined
    if (meta === undefined || typeof meta.command !== 'string') {
      throw new Error('coral: stdio endpoint requires meta.command')
    }
    const child = spawn(meta.command, [...(meta.args ?? [])], {
      ...(meta.cwd === undefined ? {} : { cwd: meta.cwd }),
      ...(meta.env === undefined ? {} : { env: { ...process.env, ...meta.env } }),
      stdio: ['pipe', 'pipe', 'inherit'] as const,
    })
    this.children.add(child)
    child.once('exit', () => { this.children.delete(child) })
    return new StdioConnection(endpoint.id, child)
  }

  async dispose(): Promise<void> {
    for (const child of [...this.children]) child.kill()
    this.children.clear()
  }
}

export const stdioTransport = {
  name: 'coral.transport.stdio',
  apply(ctx: Context): void {
    const registry = ctx.get('coralTransports', false) as unknown as { register(transport: Transport): { dispose(): void } }
    const transport = new StdioTransport()
    ctx.effect(() => {
      const registration = registry.register(transport)
      return () => registration.dispose()
    })
  },
}
