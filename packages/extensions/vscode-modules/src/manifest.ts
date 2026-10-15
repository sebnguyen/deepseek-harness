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
