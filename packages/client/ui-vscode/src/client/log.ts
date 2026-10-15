/**
 * Diagnostic breadcrumbs for the tab↔twin click path. The twin side already
 * logs into its 'DSH Twin' output channel; the browser side has no such
 * channel, so lifeline events go to the console at debug level (warn on
 * faults) under one grep-able tag: open the devtools console with verbose
 * logging enabled (or filter on `[ui-vscode]`) while reproducing a click
 * that does nothing.
 * @module @deepseek-ai/dsh-client-ui-vscode/log
 */

export const VSCODE_LOG_TAG = '[ui-vscode]'

/** Routine breadcrumb; hidden by the devtools default level filter. */
export function vscodeDebug(event: string, ...data: unknown[]): void {
  console.debug(`${VSCODE_LOG_TAG} ${event}`, ...data)
}

/** Fault breadcrumb; visible at the default devtools level. */
export function vscodeWarn(event: string, ...data: unknown[]): void {
  console.warn(`${VSCODE_LOG_TAG} ${event}`, ...data)
}
