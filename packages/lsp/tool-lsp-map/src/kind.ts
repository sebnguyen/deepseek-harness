/**
 * The pinned kind table for the `symbols` layout: which normalized symbol kinds are map-worthy and
 * the ASCII abbreviation each renders as. Model-visible text, snapshot-pinned. A kind absent from
 * this table is collapsed out of the layout entirely (fields, variables, and other noise).
 * @module @deepseek-ai/dsh-tool-lsp-map/kind
 */

import type { SymbolKindLabel } from '@deepseek-ai/dsh-lsp'

/** Map-worthy kinds → pinned ASCII abbreviation. Absent = skip (collapsed). */
export const KIND_ABBREV: Readonly<Partial<Record<SymbolKindLabel, string>>> = {
  class: 'class',
  interface: 'iface',
  method: 'method',
  function: 'func',
  enum: 'enum',
  enumMember: 'member',
  constructor: 'ctor',
  struct: 'struct',
  typeParameter: 'type',
}
