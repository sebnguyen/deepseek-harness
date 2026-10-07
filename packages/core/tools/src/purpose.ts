/**
 * Reserved harness-meta purpose field: one universal per-call reason. The
 * registry injects `PURPOSE_KEY` into every exposed object-rooted tool schema;
 * the log keeps raw arguments verbatim while `derivePurpose` lifts the key for
 * the `tool/call.purpose` sibling and strips it from the execution view before
 * guards, approval, and bodies. `dsh_harness_` is a closed reserved prefix:
 * registrations declaring it fail at load, which also makes injection
 * idempotent. Design: .agents/notes/proposed/architecture/2026-10-07-registry-injected-purpose-field.md
 * @module dsh-tools/purpose
 */

import { isPlainJsonRecord } from './json-schema.ts'

/** The single reserved harness-meta key injected into every exposed tool schema. */
export const PURPOSE_KEY = '_dsh_harness_purpose' as const

/** Closed reserved prefix for current and future harness-meta injections. */
export const RESERVED_PREFIX = '_dsh_harness_'

/** Model-facing statement of the injected field: what to write and who reads it. */
export const PURPOSE_DESCRIPTION = 'One sentence stating why this exact call is being made; it is shown to the human reviewing this session and cited in critiques of the change it produces. Optional; when absent the session UI falls back to tool-declared intent fields.'

/** The derived dispatch view of one parsed argument block. */
export interface PurposeDerivation {
  /** Arguments with the harness key removed; the raw log string is never rewritten. */
  readonly clean: unknown
  /** The lifted purpose text, or null when absent, empty, or non-string. */
  readonly purpose: string | null
}

/**
 * Whether a schema property key squats the reserved harness-meta namespace.
 * @param key - one declared property name.
 * @returns Whether the key is reserved for harness injection.
 */
export function isReservedKey(key: string): boolean {
  return key.startsWith(RESERVED_PREFIX)
}

/**
 * Reject a registration squatting the reserved namespace; the same check makes
 * projection-time injection idempotent. Non-object roots cannot squat.
 * @param parameters - declared parameter schema (`Record<string, unknown>`).
 * @param toolName - the registering tool's name; for the failure message.
 */
export function assertNoReservedSquat(parameters: Record<string, unknown>, toolName: string): void {
  if (parameters.type !== 'object' || !isPlainJsonRecord(parameters.properties)) return
  for (const key of Object.keys(parameters.properties)) {
    if (isReservedKey(key)) {
      throw new Error(`tool "${toolName}" declares reserved harness-meta key "${key}"; the ${RESERVED_PREFIX}* namespace is reserved for harness injection`)
    }
  }
}

/**
 * Inject the reserved purpose field into one exposed schema projection.
 * Object-rooted schemas gain the key appended last in `properties` and
 * `required`, leaving declared key order untouched so the exposure serializes
 * byte-identically on every call of a build. A declared
 * `additionalProperties: false` stays valid beside the injected key: a listed
 * property is never additional. Non-object roots pass through.
 * @param parameters - the losslessly detached declared parameter schema.
 * @returns the model-facing schema with the purpose field appended.
 */
export function withPurpose(parameters: Record<string, unknown>): Record<string, unknown> {
  if (parameters.type !== 'object') return parameters
  const properties = isPlainJsonRecord(parameters.properties) ? parameters.properties : {}
  const required = Array.isArray(parameters.required)
    ? parameters.required.filter((entry): entry is string => typeof entry === 'string')
    : []
  return {
    ...parameters,
    properties: {
      ...properties,
      [PURPOSE_KEY]: { type: 'string', description: PURPOSE_DESCRIPTION },
    },
    required: [...required, PURPOSE_KEY],
  }
}

/**
 * Pure derivation of the dispatch view from one parsed argument block: the
 * harness key is lifted read-only; the raw log string is never rewritten.
 * Absent, empty, or non-string values derive nothing. Non-records carry no
 * fields to lift.
 * @param parsed - parsed model arguments as the scheduler materializes them.
 * @returns the clean arguments plus the lifted purpose, or null.
 */
export function derivePurpose(parsed: unknown): PurposeDerivation {
  if (!isPlainJsonRecord(parsed)) return { clean: parsed, purpose: null }
  const value = parsed[PURPOSE_KEY]
  if (typeof value !== 'string' || value === '') return { clean: parsed, purpose: null }
  const clean: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(parsed)) {
    if (key === PURPOSE_KEY) continue
    clean[key] = entry
  }
  return { clean, purpose: value }
}
