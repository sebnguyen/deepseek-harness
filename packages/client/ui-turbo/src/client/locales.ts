/** `turbo` namespace dictionaries for the Turbo shell mode. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'rail.title': '会话',
  'rail.handle': '会话',
  'rail.open': '打开会话栏',
  'rail.close': '关闭会话栏',
  'add.column': '添加列',
  'add.row': '添加行',
  'add.limit': '最多 3 行 3 列',
  'notice.duplicate': '该会话已在其他单元格中',
  'notice.created': '已新建会话',
  'error.create': '无法新建会话',
  'cell.empty.title': '空槽位',
  'cell.empty.action': '新建会话',
  'option.title': 'Turbo 布局',
  'option.body': '与 Sammy 一起冲刺上线：为并行而生的多智能体聊天布局。',
} satisfies Record<string, string>

/** The Turbo namespace key union. */
export type TurboKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'rail.title': 'Sessions',
  'rail.handle': 'Chats',
  'rail.open': 'Open conversation rail',
  'rail.close': 'Close conversation rail',
  'add.column': 'Add column',
  'add.row': 'Add row',
  'add.limit': 'At most 3 rows and 3 columns',
  'notice.duplicate': 'That session is already in another cell',
  'notice.created': 'New session created',
  'error.create': 'Could not create a session',
  'cell.empty.title': 'Empty Slot',
  'cell.empty.action': 'New Session',
  'option.title': 'Turbo layout',
  'option.body': 'Race Sammy to production with our multi-agent chat layout, built for parallelism',
} satisfies Record<TurboKey, string>
