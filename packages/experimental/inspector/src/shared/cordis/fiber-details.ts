/** Safe, detached Fiber metadata shared by routed and consumer-neutral trees. */

import { exactObject } from '../validation.ts'

/** Fields added to every version-1 Fiber node. */
export const CORDIS_FIBER_DETAIL_KEYS = [
  'pluginName', 'entryName', 'state', 'inject', 'store', 'provides',
] as const

/** Lifecycle names mirrored from Cordis `FiberState`. */
export const CORDIS_FIBER_STATES = [
  'pending', 'loading', 'active', 'failed', 'disposed', 'unloading',
] as const

/** Serializable Cordis Fiber lifecycle name. */
export type CordisFiberState = typeof CORDIS_FIBER_STATES[number]

/** One injected Impl cache entry without its opaque service value. */
export interface CordisFiberStoreEntry {
  readonly name: string
  /** Provider Fiber uid, including the root's 0; null after provider disposal. */
  readonly providerUid: number | null
}

/** Serializable fields used by both Fiber wire models. */
export interface CordisFiberDetails {
  /** Runtime-owned plugin callback name; null for anonymous plugins. */
  readonly pluginName: string | null
  /** Loader module specifier; null for plugins mounted without a Loader entry. */
  readonly entryName: string | null
  readonly state: CordisFiberState
  /** Declared dependency names, excluding potentially secret intercept configs. */
  readonly inject: readonly string[]
  /** Cached injections, or null while the Fiber is unloaded. */
  readonly store: readonly CordisFiberStoreEntry[] | null
  /** Central-store names provided by this Fiber, including duplicate isolated names. */
  readonly provides: readonly string[]
}

/**
 * Validate the shared version-1 Fiber fields without retaining service values.
 * @param record - A plain Fiber node already checked for kind and routing fields.
 * @returns The validated detachable metadata.
 */
export function parseCordisFiberDetails(record: Record<string, unknown>): CordisFiberDetails {
  const pluginName = nullableString(record.pluginName)
  const entryName = nullableString(record.entryName)
  if (typeof record.state !== 'string'
    || !(CORDIS_FIBER_STATES as readonly string[]).includes(record.state)
    || !stringArray(record.inject)
    || !stringArray(record.provides)) invalid()
  const state = record.state as CordisFiberState
  let store: CordisFiberStoreEntry[] | null = null
  if (record.store !== null) {
    if (!Array.isArray(record.store)) invalid()
    store = record.store.map((value) => {
      const entry = exactObject(value, ['name', 'providerUid'], 'Cordis Fiber store entry')
      if (typeof entry.name !== 'string'
        || (entry.providerUid !== null
          && (!Number.isSafeInteger(entry.providerUid) || (entry.providerUid as number) < 0))) invalid()
      return { name: entry.name, providerUid: entry.providerUid as number | null }
    })
  }
  return {
    pluginName,
    entryName,
    state,
    inject: record.inject,
    store,
    provides: record.provides,
  }
}

function nullableString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value === null) return null
  return invalid()
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function invalid(): never {
  throw new Error('inspector protocol: invalid Cordis Fiber details')
}
