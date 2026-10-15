/**
 * VscodeModulesManifest — the zod-validated shape that the host composes.
 * @module @deepseek-ai/dsh-vscode-modules
 */

import { z } from 'zod'

const VscodePlaneRow = z.object({
  id: z.string(),
  name: z.string(),
  rev: z.string(),
  url: z.string(),
  inject: z.array(z.string()),
  external: z.array(z.string()),
  immediately: z.boolean(),
})

export const VscodeManifestSchema = z.object({
  rev: z.string(),
  plugins: z.array(VscodePlaneRow),
})

export type VscodeManifest = z.infer<typeof VscodeManifestSchema>
export type VscodeModulesGraph = VscodeManifest
export type VscodeModulesPlugin = VscodePlane
export type VscodePlane = z.infer<typeof VscodePlaneRow>

export const VscodeModulesManifest = VscodeManifestSchema

/**
 * The `dsh.vscode` block one package declares. Parsed separately from
 * `dsh.twin`'s descendants and `dsh.client` — a plane is never silently
 * absorbed through another face's parser.
 */
export interface DshVscodeManifest {
  /** Runtime face; only `vscode` rows compose into the seat manifest. */
  readonly platform: string
  /** Seat service keys the plane's fiber waits for before activivation. */
  readonly inject?: readonly string[]
  /** Out-of-graph specifier requests; vscode planes currently declare none. */
  readonly external?: readonly string[]
  /** Stage-one precedence hint carried verbatim onto the manifest row. */
  readonly immediately?: boolean
}

function optionalStringArray(pkgName: string, field: string, value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`vscode-modules: ${pkgName} ${field} must be a string array`)
  }
  return value as string[]
}

/**
 * Narrow an unknown parsed `dsh.vscode` field. Absent field is a negative
 * verdict; a malformed block throws — a package that half-declares the face
 * must fail loudly, never be mistaken for an ordinary host package.
 * @param pkgName - package name used as the diagnostic prefix.
 * @param value - the raw `dsh.vscode` field of the package manifest.
 * @returns the validated declaration, or undefined when the field is absent.
 */
export function parseDshVscode(pkgName: string, value: unknown): DshVscodeManifest | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) {
    throw new Error(`vscode-modules: ${pkgName} has a non-object dsh.vscode declaration`)
  }
  const decl = value as Record<string, unknown>
  if (typeof decl.platform !== 'string') {
    throw new Error(`vscode-modules: ${pkgName} dsh.vscode.platform must be a string`)
  }
  const inject = optionalStringArray(pkgName, 'dsh.vscode.inject', decl.inject)
  const external = optionalStringArray(pkgName, 'dsh.vscode.external', decl.external)
  if (decl.immediately !== undefined && typeof decl.immediately !== 'boolean') {
    throw new Error(`vscode-modules: ${pkgName} dsh.vscode.immediately must be a boolean`)
  }
  return {
    platform: decl.platform,
    ...(inject !== undefined ? { inject } : {}),
    ...(external !== undefined ? { external } : {}),
    ...(decl.immediately !== undefined ? { immediately: decl.immediately } : {}),
  }
}

/**
 * The manifest `id` for one plane package: the npm name minus the harness
 * scope prefix, matching the web's short-id convention.
 */
export function planeIdOf(pkgName: string): string {
  return pkgName.startsWith('@deepseek-ai/') ? pkgName.slice('@deepseek-ai/'.length) : pkgName
}
