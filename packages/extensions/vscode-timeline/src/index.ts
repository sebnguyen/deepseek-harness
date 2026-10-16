/**
 * Host face: intentionally inert. This package ships a vscode-face plane;
 * mounting it on the host only registers it with the vscode-modules roster
 * scan — its `dsh.vscode` block is the whole host-side payload.
 * @module @deepseek-ai/dsh-vscode-timeline
 */

// Inject the seat's facade service and the gateway-provided `remote`
// namespaces; the dot-parent `remote` service must be listed so cordis's
// property gate admits reads of the service tree this plane calls.
export const inject: readonly string[] = ['vscodeApi', 'remote', 'remote.timeline', 'remote.checkpoint']

/** The host mount contributes nothing; the plane lives on the vscode face. */
export function apply(): void {}
