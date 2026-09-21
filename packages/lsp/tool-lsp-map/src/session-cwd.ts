/**
 * Derive the workspace root a `symbols` call resolves against from the calling agent's session. A
 * missing cwd fails as `LSP_WORKSPACE_REQUIRED`.
 * @module @deepseek-ai/dsh-tool-lsp-map/session-cwd
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * The session workspace cwd for this call, or `undefined` when none applies.
 * @param exec - the tool-execution context; only its optional `agent` is read.
 * @returns the calling agent's session cwd, or undefined for a non-agent caller.
 */
export function sessionCwd(exec: ToolExecution): string | undefined {
  return exec.agent?.session.header.cwd
}
