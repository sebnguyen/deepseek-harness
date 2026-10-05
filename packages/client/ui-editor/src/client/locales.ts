/** Typed copy dictionaries for the file editor tab. */

/** Simplified Chinese table for the `editor` locale namespace. */
export const zh = {
  loading: '正在读取…',
  saving: '正在保存…',
  saved: '就绪',
  unsaved: '未保存的更改',
  save: '保存',
  revert: '还原',
  conflict: '文件在加载后已被他处修改。',
  reload: '重新加载',
  overwrite: '以我的内容覆盖',
  'error.notFound': '文件不存在，可能已被移动或删除。',
  'error.tooLarge': '文件超过可编辑的大小上限。',
  'error.readOnly': '当前会话为只读，无法保存。',
  'error.stale': '保存失败：文件已在他处更改。',
  'error.generic': '出错：{message}',
} satisfies Record<string, string>

/** The keys the `editor` namespace serves; the Simplified table types them. */
export type EditorKey = keyof typeof zh

/** English table for the `editor` locale namespace. */
export const en: Record<EditorKey, string> = {
  loading: 'Loading…',
  saving: 'Saving…',
  saved: 'Ready',
  unsaved: 'Unsaved changes',
  save: 'Save',
  revert: 'Revert',
  conflict: 'The file changed elsewhere after it was loaded.',
  reload: 'Reload',
  overwrite: 'Overwrite with mine',
  'error.notFound': 'The file does not exist; it may have been moved or deleted.',
  'error.tooLarge': 'The file is too large to edit.',
  'error.readOnly': 'This session is read-only; saving is refused.',
  'error.stale': 'Save failed: the file changed elsewhere.',
  'error.generic': 'Something went wrong: {message}',
}
