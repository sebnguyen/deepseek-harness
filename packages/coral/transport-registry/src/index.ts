import { Service, type Context } from '@deepseek-ai/cordis'
import type { Disposable, StandardId, Transport, TransportId } from '@deepseek-ai/dsh-coral'

function disposer(fn: () => void): Disposable {
  return { dispose: fn }
}

export class TransportRegistry extends Service implements Disposable {
  private readonly transports = new Map<TransportId, Transport>()
  private readonly claims = new Map<string, Transport>()

  constructor(ctx: Context) {
    super(ctx, 'coralTransports')
  }

  register(transport: Transport): Disposable {
    this.transports.set(transport.id, transport)
    return disposer(() => { this.transports.delete(transport.id) })
  }

  get(id: TransportId): Transport | null {
    return this.transports.get(id) ?? null
  }

  claim(transport: Transport, standard: StandardId): Disposable {
    if (transport.hosting !== 'exclusive') return disposer(() => {})
    const key = `${transport.id}/${standard}`
    if (this.claims.has(key)) {
      throw new Error(`coral: transport ${transport.id} already hosts ${standard}`)
    }
    this.claims.set(key, transport)
    return disposer(() => {
      if (this.claims.get(key) === transport) this.claims.delete(key)
    })
  }

  list(): readonly Transport[] {
    return [...this.transports.values()]
  }

  async closeAll(): Promise<void> {
    const transports = [...this.transports.values()]
    this.transports.clear()
    this.claims.clear()
    for (const transport of transports) await transport.dispose()
  }

  async dispose(): Promise<void> {
    await this.closeAll()
  }
}

export const transportRegistry = {
  name: 'coral.transport.registry',
  apply(ctx: Context): void {
    void new TransportRegistry(ctx)
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    coralTransports: TransportRegistry
  }
}
