import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  Client,
  ClientTemplate,
  Disposable,
  RawCapability,
  StandardId,
} from '@deepseek-ai/dsh-coral'

function disposer(fn: () => void): Disposable {
  return { dispose: fn }
}

export class ClientTemplateRegistry extends Service {
  private readonly standards = new Map<StandardId, ClientTemplate<RawCapability, Client>>()

  constructor(ctx: Context) {
    super(ctx, 'coralClientStandards')
  }

  register<Raw extends RawCapability, C extends Client>(standard: ClientTemplate<Raw, C>): Disposable {
    this.standards.set(standard.id, standard as unknown as ClientTemplate<RawCapability, Client>)
    return disposer(() => { this.standards.delete(standard.id) })
  }

  get(id: StandardId): ClientTemplate<RawCapability, Client> | null {
    return this.standards.get(id) ?? null
  }

  list(): readonly ClientTemplate<RawCapability, Client>[] {
    return [...this.standards.values()]
  }

  remove(id: StandardId): void {
    this.standards.delete(id)
  }
}

export const clientTemplateRegistry = {
  name: 'coral.client.standard.registry',
  apply(ctx: Context): void {
    void new ClientTemplateRegistry(ctx)
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    coralClientStandards: ClientTemplateRegistry
  }
}
