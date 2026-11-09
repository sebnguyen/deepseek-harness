/** Generic typed method registry shared by client and server shells. */

import type { Disposable } from './types.ts'

export type MethodMap = Readonly<
  Record<string, { readonly context: unknown; readonly result: unknown }>
>

export type RegistryMethodHandler<M extends MethodMap, K extends keyof M & string> =
  (context: M[K]['context']) => M[K]['result'] | Promise<M[K]['result']>

export interface BindOptions {
  readonly override?: boolean
}

/** Flatten the SDK's nested `methods` object into method-name strings. */
export function flattenMethods(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value === null || typeof value !== 'object') return []
  return Object.values(value).flatMap(child => flattenMethods(child))
}

/**
 * One handler per method. Binding twice throws unless `override` is set; the
 * returned disposer unbinds only the handler it installed. The owning shell
 * installs a stable protocol dispatcher that consults this map.
 */
export class MethodRegistry<M extends MethodMap> {
  private readonly handlers = new Map<
    string,
    { readonly handler: RegistryMethodHandler<M, keyof M & string>; readonly token: object }
  >()

  bind<K extends keyof M & string>(method: K, handler: RegistryMethodHandler<M, K>, options?: BindOptions): Disposable {
    if (this.handlers.has(method) && options?.override !== true) {
      throw new Error(`coral: ${method} is already bound`)
    }
    const token = {}
    this.handlers.set(method, {
      handler: handler as unknown as RegistryMethodHandler<M, keyof M & string>,
      token,
    })
    return {
      dispose: () => {
        if (this.handlers.get(method)?.token === token) this.handlers.delete(method)
      },
    }
  }

  has(method: keyof M & string): boolean {
    return this.handlers.has(method)
  }

  get methods(): readonly (keyof M & string)[] {
    return [...this.handlers.keys()] as (keyof M & string)[]
  }

  async dispatch<K extends keyof M & string>(method: K, context: M[K]['context']): Promise<M[K]['result']> {
    const entry = this.handlers.get(method)
    if (entry === undefined) throw new Error(`coral: no handler for ${method}`)
    return entry.handler(context) as M[K]['result'] | Promise<M[K]['result']>
  }

  dispose(): void {
    this.handlers.clear()
  }
}
