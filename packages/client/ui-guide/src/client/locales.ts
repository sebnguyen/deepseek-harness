/**
 * `sidebar.guide` namespace dictionaries: the sidebar harness-guide
 * section copy. English is the key-set source of truth; zh mirrors it.
 */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  'section.title': 'Harness Guide',
  'section.lede': 'Every session rides the same capability stack.',
  'guide.sandbox.title': 'Sandboxed Execution',
  'guide.sandbox.description': 'Three confinement modes with approved one-shot escalation; the surface asks before sensitive acts.',
  'guide.shell.title': 'Persistent Shell & Files',
  'guide.shell.description': 'Long-lived bash & pwsh terminals, background jobs, and live file read and edit tools.',
  'guide.delegation.title': 'Subagents & Teams',
  'guide.delegation.description': 'Delegate bounded work to spawn or fork agents, then message, steer, and orchestrate them.',
  'guide.workflows.title': 'Workflows & Ralph',
  'guide.workflows.description': 'Model-authored orchestration scripts fan agents out at scale; Ralph loops a fresh agent on one objective.',
  'guide.goals.title': 'Goals & Plan Mode',
  'guide.goals.description': 'A durable completion goal with continuation rounds, plus plan mode for human review.',
  'guide.skills.title': 'Skills',
  'guide.skills.description': 'On-demand capability packs loaded into the prompt from project or user directories.',
  'guide.web.title': 'Web Search & MCP',
  'guide.web.description': 'Live search and page fetch; any MCP server mounts into the tool set as mcp__server__tool.',
  'guide.log.title': 'Session Log & Snapshots',
  'guide.log.description': 'The session log is the source of truth; checkpoints and projections keep turns resumable.',
  'guide.plugins.title': 'Everything is a Plugin',
  'guide.plugins.description': 'The Cordis composition is the product: profiles, bundles, and presets swap whole capability sets.',
} satisfies Record<string, string>

/** The guide namespace key union. */
export type GuideKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The sidebar harness-guide section copy. */
    'sidebar.guide': GuideKey
  }
}

/** Simplified Chinese dictionary, checked complete against the en key set. */
export const zh: { [Key in GuideKey]: string } = {
  'section.title': 'Harness 功能指南',
  'section.lede': '每个会话都承载同一套能力栈。',
  'guide.sandbox.title': '沙箱执行',
  'guide.sandbox.description': '三段式隔离模式，配合审批后的一次性升级；敏感操作前先询问。',
  'guide.shell.title': '持久终端与文件',
  'guide.shell.description': '长驻 bash / pwsh 终端、后台任务，以及实时文件读写工具。',
  'guide.delegation.title': '子代理与团队',
  'guide.delegation.description': '将有限任务委派给 spawn / fork 子代理，并可持续发消息、引导与编排。',
  'guide.workflows.title': '工作流与 Ralph',
  'guide.workflows.description': '模型编写的编排脚本可大规模并行派发子代理；Ralph 以全新代理循环逼近单一目标。',
  'guide.goals.title': '目标与计划模式',
  'guide.goals.description': '带续跑轮次的持久完成目标，以及供人工审阅的计划模式。',
  'guide.skills.title': '技能',
  'guide.skills.description': '按需载入上下文的能力包，来自项目或用户目录。',
  'guide.web.title': '网页搜索与 MCP',
  'guide.web.description': '实时搜索与网页抓取；任意 MCP 服务器以 mcp__server__tool 形式挂载进工具集。',
  'guide.log.title': '会话日志与快照',
  'guide.log.description': '会话日志是唯一事实来源；检查点与投影让每一轮可恢复。',
  'guide.plugins.title': '一切皆插件',
  'guide.plugins.description': 'Cordis 组合即产品：profile、bundle 与 preset 可整体切换能力集。',
}
