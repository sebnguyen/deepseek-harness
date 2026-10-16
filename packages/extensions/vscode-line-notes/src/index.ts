/**
 * Host face: intentionally inert. This package ships a vscode-face plane;
 * mounting it on the host only registers it with the vscode-modules roster
 * scan — its `dsh.vscode` block is the whole host-side payload.
 * @module @deepseek-ai/dsh-vscode-line-notes
 */

// Mirror of the twin plane's inject contract (see vscode-timeline): the
// `remote` parent service and the facade are required for the reads.
export const inject: readonly string[] = ['vscodeApi', 'remote', 'remote.lineNotes']

/** The host mount contributes nothing; the plane lives on the vscode face. */
export function apply(): void {}
