/**
 * Host face: intentionally inert. This package ships a vscode-face plane;
 * mounting it on the host only registers it with the vscode-modules roster
 * scan — its `dsh.vscode` block is the whole host-side payload. Seat
 * services (`vscodeApi`, `remote.*`) belong on the vscode face; declaring
 * them here leaves the host entry pending, because the host never provides
 * them.
 * @module @deepseek-ai/dsh-vscode-line-notes
 */

/** No host services: `apply` is a no-op and the roster reads `package.json`. */
export const inject: readonly string[] = []

/** The host mount contributes nothing; the plane lives on the vscode face. */
export function apply(): void { }
