/** `layout-mode` dictionaries for the launch chooser. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'choose.eyebrow': '布局模式',
  'choose.title': '选择窗口模式',
  'choose.body': '模式在窗口打开后固定；要切换模式，请打开新的窗口。',
  'choose.default': '默认布局',
  'choose.default.body': '标准 Harness 外观，内置 VS Code 编辑器，满足你深入探索的全部需要。',
} satisfies Record<string, string>

/** The layout-mode namespace key union. */
export type LayoutModeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'choose.eyebrow': 'Layout mode',
  'choose.title': 'Choose a window mode',
  'choose.body': 'The mode is fixed for this window. To switch modes, open a new window.',
  'choose.default': 'Default layout',
  'choose.default.body': 'Your standard Harness look with a built in VS Code editor for all your deep diving need',
} satisfies Record<LayoutModeKey, string>
