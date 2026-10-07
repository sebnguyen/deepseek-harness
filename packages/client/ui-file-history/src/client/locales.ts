/**
 * Locale dictionaries for the file-history view. Every user-visible string the
 * view renders lives here; `verify-client-ui-i18n` rejects hardcoded copy.
 *
 * @module ui-file-history/locales
 */

/** Namespace the file-history view registers its copy under. */
export const NS = 'fileHistory'

/** Chinese dictionary (the key set every other locale must cover). */
export const zh = {
  'view.files': '文件快照',
  'files.aria': '本会话改动过的文件',
  'files.title': '工作区快照',
  'files.empty': '本会话还没有文件被改动。',
  'files.stopCount': '{count} 个快照点',
  'files.created': '新建',
  'files.deleted': '删除',
  'zoom.aria': '时间线粒度',
  'zoom.turn': '按回合',
  'zoom.call': '按工具调用',
  'slider.aria': '快照时间点',
  'stop.turn': '第 {turn} 回合 · 第 {step} 步',
  'stop.tool': '工具 {tool}',
  'stop.noPurpose': '未记录用途',
  'stop.restore': '恢复到该快照点',
  'stop.restoring': '正在恢复…',
  'stop.restored': '已恢复 {path}',
  'diff.copy': '复制',
  'diff.copied': '已复制',
  'diff.collapse': '折叠',
  'diff.expand': '展开其余 {hidden} 行',
  'diff.collapseAria': '折叠差异',
  'diff.expandAria': '展开其余 {hidden} 行差异',
  'diff.files': '{count} 个文件',
} as const

/** The file-history dictionary key union. */
export type FileHistoryKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The complete file-history timeline and restore copy. */
    fileHistory: FileHistoryKey
  }
}

/** English dictionary, covering every Chinese key. */
export const en: Record<FileHistoryKey, string> = {
  'view.files': 'Files',
  'files.aria': 'Files changed in this session',
  'files.title': 'Workspace snapshots',
  'files.empty': 'No file has changed in this session yet.',
  'files.stopCount': '{count} stops',
  'files.created': 'created',
  'files.deleted': 'deleted',
  'zoom.aria': 'Timeline granularity',
  'zoom.turn': 'By turn',
  'zoom.call': 'By tool call',
  'slider.aria': 'Snapshot stop',
  'stop.turn': 'Turn {turn} · step {step}',
  'stop.tool': 'Tool {tool}',
  'stop.noPurpose': 'No stated purpose',
  'stop.restore': 'Restore this stop',
  'stop.restoring': 'Restoring…',
  'stop.restored': 'Restored {path}',
  'diff.copy': 'Copy',
  'diff.copied': 'Copied',
  'diff.collapse': 'Collapse',
  'diff.expand': 'Show {hidden} more lines',
  'diff.collapseAria': 'Collapse the diff',
  'diff.expandAria': 'Show {hidden} more diff lines',
  'diff.files': '{count} files',
}
