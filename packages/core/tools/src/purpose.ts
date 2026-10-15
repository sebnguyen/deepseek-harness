/**
 * Harness-meta purpose field: one universal per-call reason, named
 * `description`. The registry injects `PURPOSE_KEY` into every exposed
 * object-rooted tool schema whose parameters do not already declare a
 * `description` property — injection is additive-or-unchanged, NEVER a
 * replacement: a tool-authored `description` (the shell tools' required
 * per-command line is the canonical example) stays byte-identical and simply
 * serves as the call's purpose. The log keeps raw arguments verbatim while
 * `derivePurpose` lifts the key for the `tool/call.purpose` sibling; the
 * registry strips an INJECTED key from the execution view before guards,
 * approval, and bodies, while a tool-declared key stays in dispatch as that
 * tool's own argument.
 *
 * `_dsh_harness_` remains a closed reserved prefix for future harness-meta
 * injections: registrations declaring it fail at load.
 * Design: .agents/notes/proposed/architecture/2026-10-07-registry-injected-purpose-field.md
 * @module dsh-tools/purpose
 */

import { isPlainJsonRecord } from './json-schema.ts'

/**
 * The single harness-meta key injected into every exposed tool schema that
 * does not declare it. A tool may declare `description` itself; the injection
 * then leaves the declaration unchanged and the tool's own argument doubles
 * as the purpose the harness lifts.
 */
export const PURPOSE_KEY = 'description' as const

/** Closed reserved prefix for current and future harness-meta injections. */
export const RESERVED_PREFIX = '_dsh_harness_'

/** Model-facing statement of the injected field: what to write and who reads it. */
export const PURPOSE_DESCRIPTION = 'One sentence stating why this exact call is being made; it is shown to the human reviewing this session and cited in critiques of the change it produces. Required on every call: the execution sees only the remaining arguments.'

/** The derived dispatch view of one parsed argument block. */
export interface PurposeDerivation {
  /** Arguments with the purpose key removed; the raw log string is never rewritten. */
  readonly clean: unknown
  /** The lifted purpose text, or null when absent, empty, or non-string. */
  readonly purpose: string | null
}

/**
 * Whether a schema property key squats the reserved harness-meta namespace.
 * Applies ONLY to the `_dsh_harness_` prefix; `description` itself is a key
 * tools may declare, with the injection deduping around it.
 * @param key - one declared property name.
 * @returns Whether the key is reserved for harness injection.
 */
export function isReservedKey(key: string): boolean {
  return key.startsWith(RESERVED_PREFIX)
}

/**
 * Reject a registration squatting the reserved namespace. Non-object roots
 * cannot squat.
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
 * Whether a declared parameter schema already carries the purpose key, making
 * the tool's own `description` argument the purpose the harness lifts. The
 * dispatch handoff reads this to keep a declared key in the execution view
 * (it is the tool's own contract) while stripping an injected one.
 * @param parameters - declared parameter schema (`Record<string, unknown>`).
 * @returns Whether `properties.description` is declared.
 */
export function declaresPurposeKey(parameters: Record<string, unknown>): boolean {
  return parameters.type === 'object'
    && isPlainJsonRecord(parameters.properties)
    && Object.hasOwn(parameters.properties, PURPOSE_KEY)
}

/**
 * Inject the purpose field into one exposed schema projection. Object-rooted
 * schemas lacking `description` gain the key appended last in `properties`
 * and `required`, leaving declared key order untouched so the exposure
 * serializes byte-identically on every call of a build. A schema already
 * declaring `description` passes through byte-identical — injection is
 * additive-or-unchanged, never a replacement — which also makes injection
 * idempotent. A declared `additionalProperties: false` stays valid beside the
 * injected key: a listed property is never additional. Non-object roots pass
 * through.
 * @param parameters - the losslessly detached declared parameter schema.
 * @returns the model-facing schema with the purpose field ensured.
 */
export function withPurpose(parameters: Record<string, unknown>): Record<string, unknown> {
  if (parameters.type !== 'object') return parameters
  const properties = isPlainJsonRecord(parameters.properties) ? parameters.properties : {}
  // Dedup: a tool-declared `description` IS the purpose field; leave the
  // declaration (and its `required` list) completely unchanged.
  if (Object.hasOwn(properties, PURPOSE_KEY)) return parameters
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
 * purpose key is lifted read-only; the raw log string is never rewritten.
 * Absent, empty, or non-string values derive nothing. Non-records carry no
 * fields to lift. The CALLER decides whether `clean` applies: the registry
 * strips an injected key from the execution view but keeps a tool-declared
 * `description` in place as that tool's own argument.
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
