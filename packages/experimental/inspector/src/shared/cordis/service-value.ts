/** On-demand, bounded previews of exact Cordis service values. */

import type { CordisServiceGetQuery, CordisServicePreview } from '../bridge/messages/query/commands.ts'
import type { InspectorObjectReference } from './object-reference.ts'
import { isJsonValue, isPlainObject } from '../json.ts'
import { realmObjectExpression } from './object-registry.ts'

/**
 * Build an in-realm expression that resolves the selected consumer/provider
 * object before reading only its current service value. Provided services use
 * the same name-sorted duplicate order as the snapshot collector.
 * @param reference - Live Fiber retained by the latest tree snapshot.
 * @param query - Exact selected injection or provided occurrence.
 * @returns Side-effect-free expression apart from explicit value inspection.
 */
export function cordisServiceExpression(
  reference: InspectorObjectReference,
  query: CordisServiceGetQuery,
): string {
  const lookup = realmObjectExpression(reference)
  return `(() => {
    const fiber = ${lookup}
    if (fiber === undefined) return { kind: 'summary', text: 'stale-source' }
    const name = ${JSON.stringify(query.name)}
    const typeName = (value) => {
      try {
        return typeof value.constructor?.name === 'string' ? value.constructor.name : 'Object'
      } catch {
        return 'Object'
      }
    }
    const inspect = (value, ancestors = [], depth = 0) => {
      const type = typeof value
      if (value === null || type === 'string' || type === 'boolean') return value
      if (type === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value
      if (type !== 'object') throw new TypeError('value is not JSON serializable')
      if (value instanceof Date) throw new TypeError('Date values are not inspected')
      if (ancestors.includes(value)) throw new TypeError('circular reference')
      if (depth > 4) throw new TypeError('value exceeds the nesting preview limit')
      const nested = [...ancestors, value]
      if (Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype) {
        if (value.length > 100) throw new TypeError('array exceeds the preview limit')
        return value.map(item => inspect(item, nested, depth + 1))
      }
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(typeName(value) + ' instance')
      }
      const result = {}
      const keys = Object.keys(value)
      if (keys.length > 100) throw new TypeError('object exceeds the preview limit')
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined || descriptor.enumerable !== true) continue
        if (!('value' in descriptor)) throw new TypeError('accessors are not invoked')
        try {
          result[key] = inspect(descriptor.value, nested, depth + 1)
        } catch (error) {
          throw new TypeError('nested value is not JSON serializable: ' + String(error))
        }
      }
      return result
    }
    const preview = (value) => {
      try {
        return { kind: 'json', value: inspect(value) }
      } catch (error) {
        return { kind: 'summary', text: String(error) }
      }
    }
    if (${JSON.stringify(query.kind)} === 'injected') return (() => {
      const expected = ${JSON.stringify(query.kind === 'injected' ? query.providerUid : null)}
      if (expected === null) return { kind: 'summary', text: 'provider is disposed' }
      const impl = fiber.ctx.reflect._getImpl(name)
      if (impl === undefined || impl.fiber.uid !== expected) return { kind: 'summary', text: 'stale-source' }
      return preview(impl.value)
    })()
    const expectedOccurrences = ${JSON.stringify(query.kind === 'provided' ? query.occurrences : 0)}
    const ordinal = ${JSON.stringify(query.kind === 'provided' ? query.ordinal : 0)}
    const store = fiber.ctx.root.reflect.store
    const matches = Reflect.ownKeys(store)
      .map(key => store[key])
      .filter(impl => impl !== undefined && impl.fiber === fiber && impl.name === name)
    if (matches.length !== expectedOccurrences || matches[ordinal] === undefined) {
      return { kind: 'summary', text: 'stale-source' }
    }
    return preview(matches[ordinal].value)
  })()`
}

/**
 * Validate a preview returned by an inspected realm before wiring it onward.
 * @param value - Candidate realm descriptor value.
 * @returns The validated detached preview.
 */
export function parseCordisServicePreview(value: unknown): CordisServicePreview {
  if (!isPlainObject(value) || (value.kind !== 'json' && value.kind !== 'summary')) {
    throw new Error('inspector protocol: invalid Cordis service preview')
  }
  if (value.kind === 'json') {
    if (!isJsonValue(value.value)) throw new Error('inspector protocol: Cordis service value must be JSON compatible')
    return { kind: 'json', value: value.value }
  }
  if (typeof value.text !== 'string') throw new Error('inspector protocol: Cordis service summary must be a string')
  return { kind: 'summary', text: value.text }
}
