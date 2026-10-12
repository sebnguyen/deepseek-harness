/**
 * `turn-shape` namespace dictionaries.
 * @module @deepseek-ai/dsh-client-conversation-mode/locales
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'label.narrate': '叙述',
  'label.quiet': '安静',
  'label.tools': '仅工具',
  'title.narrate': '叙述：照常显示思考、工具与收尾回答',
  'title.quiet': '安静：显示思考与工具行，结束时给出简洁回答。下一轮生效。',
  'title.tools': '仅工具：显示思考与工具行；回合结束时不输出总结。下一轮生效。',
} satisfies Record<string, string>

/** The turn-shape namespace key union. */
export type TurnShapeKey = keyof typeof zh

/** English dictionary: mirrors the key-set source of truth. */
export const en: Record<TurnShapeKey, string> = {
  'label.narrate': 'Narrate',
  'label.quiet': 'Quiet',
  'label.tools': 'Tools only',
  'title.narrate': 'Narrate: thoughts, tools, and closing answers as usual',
  'title.quiet': 'Quiet: thoughts and tool rows; closes with one plain answer. Applies to the next turn.',
  'title.tools': 'Tools only: thoughts and tool rows; the turn ends without a summary. Applies to the next turn.',
}
