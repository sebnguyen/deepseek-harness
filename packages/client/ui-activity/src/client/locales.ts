/** `activity` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'activity'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.live.one': '{count} 个后台活动运行中',
  'chip.live.other': '{count} 个后台活动运行中',
  'chip.idle.one': '{count} 个后台活动',
  'chip.idle.other': '{count} 个后台活动',
  'drawer.aria': '后台活动',
  'section.live': '运行中',
  'section.archive': '已归档（{count}）',
  'filter.alive': '仅显示运行中',
  'tree.live.aria': '运行中的活动',
  'tree.archive.aria': '已归档的活动',
  'detail.aria': '活动详情',
  'detail.empty': '选择一行以查看详情',
  'output.aria': '作业输出',
  'output.empty': '暂无输出',
  'open.session': '作为会话打开',
  'status.running': '运行中',
  'status.stopping': '正在停止',
  'status.completed': '已完成',
  'status.killed': '已取消',
  'status.failed': '已失败',
  'status.inactive': '不活动',
  'duration.seconds': '{seconds}秒',
  'duration.minutes': '{minutes}分{seconds}秒',
  'duration.hours': '{hours}小时{minutes}分',
  'duration.title.live': '已运行 {duration}',
  'duration.title.done': '耗时 {duration}',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<ActivityKey, string> = {
  'chip.live.one': '{count} background activity running',
  'chip.live.other': '{count} background activities running',
  'chip.idle.one': '{count} background activity',
  'chip.idle.other': '{count} background activities',
  'drawer.aria': 'Background activity',
  'section.live': 'Live',
  'section.archive': 'Archive ({count})',
  'filter.alive': 'Alive only',
  'tree.live.aria': 'Live activity',
  'tree.archive.aria': 'Archived activity',
  'detail.aria': 'Activity detail',
  'detail.empty': 'Select a row to see its detail',
  'output.aria': 'Job output',
  'output.empty': 'No output yet',
  'open.session': 'Open as session',
  'status.running': 'running',
  'status.stopping': 'stopping',
  'status.completed': 'completed',
  'status.killed': 'cancelled',
  'status.failed': 'failed',
  'status.inactive': 'inactive',
  'duration.seconds': '{seconds}s',
  'duration.minutes': '{minutes}m {seconds}s',
  'duration.hours': '{hours}h {minutes}m',
  'duration.title.live': 'Running for {duration}',
  'duration.title.done': 'Took {duration}',
}

/** Key domain of the `activity` namespace (zh is the source of truth). */
export type ActivityKey = keyof typeof zh
