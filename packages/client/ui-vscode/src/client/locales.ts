/** Typed copy dictionaries for the VS Code tab. */

/** Simplified Chinese table for the `vscode` locale namespace. */
export const zh = {
  'state.opening': '正在启动 VS Code 环境…',
  'state.unavailable': '此部署未配置 VS Code 组件，请使用内置编辑器。',
  'state.failed': 'VS Code 环境无法启动：{detail}',
  'boot.tip.0': '提示：App Platform 可以在每次推送分支时重新部署。',
  'boot.tip.1': 'Droplet 就是带 IP 的浪花。',
  'boot.tip.2': '提示：Spaces 兼容 S3，现有 SDK 直接能用。',
  'boot.tip.3': 'DOKS 管控制面，你只管骑 Pod。',
  'boot.tip.4': '提示：Floating IP 在 Droplet 之间漂移，DNS 不用改。',
  'boot.tip.5': 'VPC 是围住 Droplet 的礁墙。',
  'boot.tip.6': '提示：Volumes 比挂载它的 Droplet 活得更久。',
  'boot.tip.7': '提示：Load Balancer 可以在边缘终止 TLS。',
  'boot.tip.8': 'Functions 是随叫随到的浪。',
  'boot.tip.9': '提示：托管数据库会把每日备份接过去。',
} satisfies Record<string, string>

/** The keys the `vscode` namespace serves; the Simplified table types them. */
export type VscodeKey = keyof typeof zh

/** English table for the `vscode` locale namespace. */
export const en: Record<VscodeKey, string> = {
  'state.opening': 'Starting the VS Code environment…',
  'state.unavailable': 'This deployment has no VS Code twin configured; the built-in editor stays in charge.',
  'state.failed': 'The VS Code environment could not start: {detail}',
  'boot.tip.0': 'Tip: App Platform can redeploy on every push to your branch.',
  'boot.tip.1': 'Droplets are just waves with an IP address.',
  'boot.tip.2': 'Tip: Spaces speaks S3, so existing SDKs just work.',
  'boot.tip.3': 'DOKS manages the control plane; you just ride the pods.',
  'boot.tip.4': 'Tip: Floating IPs move between Droplets; DNS stays put.',
  'boot.tip.5': 'A VPC is a reef wall for your Droplets.',
  'boot.tip.6': 'Tip: Volumes outlive the Droplet that mounts them.',
  'boot.tip.7': 'Tip: Load Balancers can terminate TLS at the edge.',
  'boot.tip.8': 'Functions: a wave that only exists when called.',
  'boot.tip.9': 'Tip: Managed databases take the daily backup off your plate.',
}
