import { Service, type Context } from '@deepseek-ai/cordis'
import type { Disposable, ServerTemplate, StandardId } from '@deepseek-ai/dsh-coral'

function disposer(fn: () => void): Disposable {
  return { dispose: fn }
}

export class ServerTemplateRegistry extends Service {
  private readonly standards = new Map<StandardId, ServerTemplate>()

  constructor(ctx: Context) {
    super(ctx, 'coralServerStandards')
  }

  register(standard: ServerTemplate): Disposable {
    this.standards.set(standard.id, standard)
    return disposer(() => { this.standards.delete(standard.id) })
  }

  get(id: StandardId): ServerTemplate | null {
    return this.standards.get(id) ?? null
  }

  list(): readonly ServerTemplate[] {
    return [...this.standards.values()]
  }

  remove(id: StandardId): void {
    this.standards.delete(id)
  }
}

export const serverTemplateRegistry = {
  name: 'coral.server.standard.registry',
  apply(ctx: Context): void {
    void new ServerTemplateRegistry(ctx)
  },
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    coralServerStandards: ServerTemplateRegistry
  }
}
