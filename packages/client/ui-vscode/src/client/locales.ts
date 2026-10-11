/** Typed copy dictionaries for the VS Code tab. */

/** Simplified Chinese table for the `vscode` locale namespace. */
export const zh = {
  'state.opening': '正在启动 VS Code 环境…',
  'state.unavailable': '此部署未配置 VS Code 组件，请使用内置编辑器。',
  'state.failed': 'VS Code 环境无法启动：{detail}',
} satisfies Record<string, string>

/** The keys the `vscode` namespace serves; the Simplified table types them. */
export type VscodeKey = keyof typeof zh

/** English table for the `vscode` locale namespace. */
export const en: Record<VscodeKey, string> = {
  'state.opening': 'Starting the VS Code environment…',
  'state.unavailable': 'This deployment has no VS Code twin configured; the built-in editor stays in charge.',
  'state.failed': 'The VS Code environment could not start: {detail}',
}
