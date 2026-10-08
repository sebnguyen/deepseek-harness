/**
 * Model-facing read, read_image, and the unified write tool over `ctx.fs`. This package owns schemas, validation,
 * read windows, formatting, and observation events, never a concrete provider. The shipped
 * read/write faces are `files` batches whose elements settle into labeled frames;
 * config `legacyFaces` re-registers the pre-batch singular calls for recorded-session
 * replay, whose committed model behavior never batches. The tool-owned
 * gate supplies default write decisions from observed state (explicit overwrite flag for unread
 * files, fresh CAS basis for sed programs); loading `fs-observation-policy` on top restores
 * strict read-before-mutation for that deployment.
 * @module @deepseek-ai/dsh-tool-fs
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-user-approval'
import { applyReadTool, MAX_FILES_PER_CALL, READ_LIMIT, STREAM_MIN_SIZE } from './read.ts'
import { applyWriteTool } from './write.ts'
import { applyReadImageTool } from './read-image.ts'
import { READ_MAX_BYTES, READ_MAX_LINE_LENGTH } from './read-render.ts'
import { ToolOwnedGate } from './gate.ts'
import { FsSandboxController } from './sandbox.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-fs'

/** Services required by the filesystem tool suite. */
export const inject = ['tools', 'fs', 'systemPrompt']

/** Plugin config (all optional — `Config` supplies the defaults). */
export interface Config {
  /** Default and maximum number of lines returned by one `read` element. */
  readLimit?: number
  /** Maximum characters returned for a single line before truncation. */
  readMaxLineLength?: number
  /** Maximum bytes returned for the selected lines of one `read` element. */
  readMaxBytes?: number
  /** Files at or above this size stream instead of loading whole into memory. */
  readStreamMinSize?: number
  /** Maximum elements one batched `read` or `write` call accepts. */
  maxFilesPerCall?: number
  /**
   * Register the pre-batch singular `read`/`write` calls instead of the `files`
   * batch faces. Reserved for recorded-session replay compositions whose
   * committed fixtures drive singular calls; shipped deployments keep the
   * default false.
   */
  legacyFaces?: boolean
}

export const Config: z<Config> = z.object({
  readLimit: z.number().default(READ_LIMIT),
  readMaxLineLength: z.number().default(READ_MAX_LINE_LENGTH),
  readMaxBytes: z.number().default(READ_MAX_BYTES),
  readStreamMinSize: z.number().default(STREAM_MIN_SIZE),
  maxFilesPerCall: z.number().default(MAX_FILES_PER_CALL),
  legacyFaces: z.boolean().default(false),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>

/** Every read cap counts lines/chars/bytes/files — a positive integer, or windowing and batch arithmetic misbehave silently. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-fs: ${name} must be a positive integer`)
  }
}

/** Register the `read`/`write` filesystem tools and `read_image` while `attachments` is mounted. */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const resolved = config as ResolvedConfig
  assertPositiveInteger('readLimit', resolved.readLimit)
  assertPositiveInteger('readMaxLineLength', resolved.readMaxLineLength)
  assertPositiveInteger('readMaxBytes', resolved.readMaxBytes)
  assertPositiveInteger('readStreamMinSize', resolved.readStreamMinSize)
  assertPositiveInteger('maxFilesPerCall', resolved.maxFilesPerCall)
  applyReadTool(ctx, {
    limit: resolved.readLimit,
    maxLineLength: resolved.readMaxLineLength,
    maxBytes: resolved.readMaxBytes,
    streamMinSize: resolved.readStreamMinSize,
    maxFiles: resolved.maxFilesPerCall,
  }, resolved.legacyFaces)
  // read_image is composition-conditional: without a mounted attachment store
  // the deployment cannot durably commit image bytes, so the tool never
  // registers; the execute body keeps a defensive re-check for direct callers.
  ctx.inject(['attachments'], (imageCtx) => {
    applyReadImageTool(imageCtx)
  })
  // One escalation API shared by both mutating tools: advertisement gating,
  // per-call policy resolution, and denial-marker mapping, all keyed off whether
  // the mounted ctx.fs confines (ctx.fs.sandboxMode).
  const sandbox = new FsSandboxController(ctx)
  const gate = new ToolOwnedGate(ctx)
  gate.registerObservedListener()
  ctx.effect(() => () => {
    // Drop recorded state on disposal so a reloaded plugin starts clean (HMR).
    gate.clear()
  }, 'tool-fs observed-state teardown')
  applyWriteTool(ctx, sandbox, gate, resolved.maxFilesPerCall, resolved.legacyFaces)
}
