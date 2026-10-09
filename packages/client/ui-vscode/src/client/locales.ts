/** Typed copy dictionaries for the frame tab. */

/** Simplified Chinese table for the `vscode` locale namespace. */
export const zh = {
  frame: 'VS Code 编辑平面',
  absent: '编辑平面未就绪，正在回落到内置编辑器。',
  loading: '正在连接编辑平面…',
} satisfies Record<string, string>

/** The keys the `vscode` namespace serves; the Simplified table types them. */
export type VscodeKey = keyof typeof zh

/** English table for the `vscode` locale namespace. */
export const en: Record<VscodeKey, string> = {
  frame: 'VS Code editor plane',
  absent: 'The editor plane is not ready; falling back to the built-in editor.',
  loading: 'Connecting to the editor plane…',
}
