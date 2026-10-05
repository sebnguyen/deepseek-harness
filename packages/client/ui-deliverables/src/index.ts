/**
 * Deliverables plugin, node half. Registers the response-format guidance that
 * lets the browser half recognize final-response file references and serves
 * authenticated native opens of declared files. The browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { registerPresentOpen } from './present-open.ts'

/** Services required for file-reference guidance and authenticated native opens of declared files. */
export const inject = ['systemPrompt', 'tools', 'connection', 'sessionQuery', 'sessionController', 'workspaceFiles', 'fs', 'sandboxPolicy']

/** Stable final-response guidance owned by the matching renderer, rendered only while `present` is visible. */
const FILE_REFERENCE_PROMPT = 'Advice: When you successfully create or modify files, mention the primary outputs in your final response. '
  + 'To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path, or a basename when unique among the files changed in that turn.'

/**
 * Register model guidance for the file-reference renderer shipped by this package.
 * @param ctx - host context carrying the system-prompt registry.
 */
export function apply(ctx: Context): void {
  registerPresentOpen(ctx)
  ctx.systemPrompt.section({
    name: 'ui:deliverable-file-references',
    order: ctx.systemPrompt.getSectionOrder('DELIVERABLE_FILE_REFERENCES'),
    text: ({ scope }) => ctx.tools.get('present', scope) === undefined ? '' : FILE_REFERENCE_PROMPT,
  })
}
