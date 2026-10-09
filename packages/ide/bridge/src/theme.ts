/**
 * Generate the dsh-dark theme map: vscode color ids onto the exact dark-mode
 * `--shiki-token-*` values ui-theme publishes, so in-frame code tokens equal our
 * CodeBlock palette token-for-token by construction. The build lane re-runs
 * this against the live sheet; this file fixes the skeleton mapping.
 */

/** The dark shiki values copied from ui-theme's shiki.css dark overrides. */
export const DSH_DARK_TOKENS = {
  constant: '#61c8f9',
  string: '#60a5af',
  comment: '#738484',
  keyword: '#daa549',
  parameter: '#d48b63',
  function: '#ddc4d8',
  stringExpression: '#c0dee1',
  punctuation: '#c5cdcd',
  link: '#94c6cc',
} as const

/** The frame's editor chrome, kept on our markdown-code-block background. */
export const DSH_DARK_CHROME = {
  background: '#1b1b1c',
  foreground: '#f4f5f6',
  lineNumber: '#7a7f85',
} as const

/**
 * The theme contribution the built-in registers.
 * @returns the `contributes.themes[0]` object for product.json wiring.
 */
export function dshDarkTheme(): Record<string, unknown> {
  const t = DSH_DARK_TOKENS
  return {
    id: 'dsh-dark',
    label: 'dsh Dark',
    type: 'dark',
    colors: {
      'editor.background': DSH_DARK_CHROME.background,
      'editor.foreground': DSH_DARK_CHROME.foreground,
      'editorLineNumber.foreground': DSH_DARK_CHROME.lineNumber,
    },
    tokenColors: [
      { scope: ['keyword', 'storage.type'], settings: { foreground: t.keyword } },
      { scope: ['string', 'string.quoted'], settings: { foreground: t.string } },
      { scope: ['string.template', 'constant.character.escape'], settings: { foreground: t.stringExpression } },
      { scope: ['comment'], settings: { foreground: t.comment } },
      { scope: ['constant', 'constant.numeric', 'variable.other.constant'], settings: { foreground: t.constant } },
      { scope: ['entity.name.function', 'support.function'], settings: { foreground: t['function'] } },
      { scope: ['variable.parameter'], settings: { foreground: t.parameter } },
      { scope: ['punctuation'], settings: { foreground: t.punctuation } },
      { scope: ['markup.underline.link'], settings: { foreground: t.link } },
    ],
  }
}
