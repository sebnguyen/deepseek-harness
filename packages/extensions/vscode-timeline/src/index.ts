/**
 * Host face: intentionally inert. This package ships a vscode-face plane;
 * mounting it on the host only registers it with the vscode-modules roster
 * scan — its `dsh.vscode` block is the whole host-side payload.
 * @module @deepseek-ai/dsh-vscode-timeline
 */

export const inject: readonly string[] = []

/** The host mount contributes nothing; the plane lives on the vscode face. */
export function apply(): void {}
