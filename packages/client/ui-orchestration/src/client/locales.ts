/** `orchestration` namespace dictionaries for the two-session mode. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'option.title': '编排布局',
  'option.body': '两个会话并排显示，并带有直接交接轨道，让并行工作保持可见。',
  'mode.eyebrow': 'ORCHESTRATION',
  'mode.title': '两个会话，一个根',
  'mode.body': '并排查看当前会话和它的直接子会话。关系是会话投影，不是第二个运行时。',
  'peer.a': '会话 A',
  'peer.b': '会话 B',
  'peer.root': '根会话',
  'peer.child': '子会话',
  'peer.running': '运行中',
  'peer.idle': '空闲',
  'handoff.title': '交接',
  'handoff.linked': '直接子会话',
  'handoff.independent': '独立会话',
  'handoff.empty': '没有直接子会话',
  'handoff.hint': '用子代理任务派生出同级会话。',
  'empty.title': '还没有会话',
  'empty.body': '新建一个会话，或打开一个已有的会话。',
  'empty.new': '新建会话',
  'empty.second': '打开第二个会话',
  'error.create': '无法新建会话',
} satisfies Record<string, string>

/** The orchestration namespace key union. */
export type OrchestrationKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'option.title': 'Orchestration layout',
  'option.body': 'Two Sessions side by side with a direct handoff rail, so parallel work stays visible.',
  'mode.eyebrow': 'ORCHESTRATION',
  'mode.title': 'Two sessions, one root',
  'mode.body': 'See the current Session beside its direct child. The relation is a session projection, not a second runtime.',
  'peer.a': 'Session A',
  'peer.b': 'Session B',
  'peer.root': 'Root session',
  'peer.child': 'Child session',
  'peer.running': 'Running',
  'peer.idle': 'Idle',
  'handoff.title': 'Handoff',
  'handoff.linked': 'Direct child',
  'handoff.independent': 'Independent sessions',
  'handoff.empty': 'No direct child sessions',
  'handoff.hint': 'Spawn work with the subagent tool to grow this rail.',
  'empty.title': 'No sessions yet',
  'empty.body': 'Create a Session, or open an existing one.',
  'empty.new': 'New Session',
  'empty.second': 'Open a second Session',
  'error.create': 'Could not create a Session',
} satisfies Record<OrchestrationKey, string>
