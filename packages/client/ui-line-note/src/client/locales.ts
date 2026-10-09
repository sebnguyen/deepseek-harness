/** Typed copy dictionaries for the line-note gutter and popover. */

/** Simplified Chinese table for the `lineNote` locale namespace. */
export const zh = {
  addNote: '为该行添加备注',
  hasNote: '该行已有备注',
  placeholder: '第 {n} 行的备注…',
  submit: '添加',
  cancel: '取消',
} satisfies Record<string, string>

/** The keys the `lineNote` namespace serves; the Simplified table types them. */
export type LineNoteKey = keyof typeof zh

/** English table for the `lineNote` locale namespace. */
export const en: Record<LineNoteKey, string> = {
  addNote: 'Add a note for this line',
  hasNote: 'This line has a note',
  placeholder: 'Note for line {n}…',
  submit: 'Add',
  cancel: 'Cancel',
}
