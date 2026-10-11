/**
 * The twin's DigitalOcean identity, shipped as a tiny builtin-style extension
 * staged into the twin's `--extensions-dir` on every spawn.
 *
 * Why an extension: the REH-web workbench keeps user settings in the
 * browser's IndexedDB (`vscode-userdata`), not on the server's disk — a
 * seeded `User/settings.json` is invisible to it. An extension's
 * `configurationDefaults` slot is the vscode-native channel for product-level
 * defaults: the workbench reads it from the installed-extension scan costs
 * nothing to activate, applies the hush and palette without touching user
 * storage, and still lets any user override win in IndexedDB. The theme
 * itself is a first-class theme contribution (`DO Harness Dark`) so the
 * whole palette and syntax colors ship as one coherent theme instead of
 * colorCustomizations wedges.
 *
 * Palette and typography mirror `packages/client/ui-theme` at its dark alias
 * layer (bluish slate, `#7bb4bc` brand accent) and the shared `shiki.css`
 * code colors, so the editor and the harness page read as one product.
 * @module @deepseek-ai/dsh-api-ide/twin-theme
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The staged extension's stable directory name inside `--extensions-dir`. */
export const TWIN_THEME_EXTENSION_ID = 'dsh.do-harness'
export const TWIN_THEME_EXTENSION_VERSION = '0.0.1'
export const TWIN_THEME_DIR_NAME = `${TWIN_THEME_EXTENSION_ID}-${TWIN_THEME_EXTENSION_VERSION}`

/** Workbench colors, walking the harness bluish scale like the app chrome. */
export const DO_THEME_COLORS: Record<string, string> = {
  // Base ink for every widget the sub-grounds don't paint explicitly.
  'foreground': '#f7f8f8',
  'descriptionForeground': '#a0a2a3',
  'icon.foreground': '#f7f8f8',
  // App shell backgrounds walk the bluish scale 950→875 like the harness page.
  'activityBar.background': '#121618',
  'activityBar.foreground': '#f7f8f8',
  'activityBar.inactiveForeground': '#738484',
  'activityBarBadge.background': '#7bb4bc',
  'activityBarBadge.foreground': '#121618',
  'editorGroupHeader.tabsBackground': '#121618',
  'minimap.background': '#121618',
  'sideBar.background': '#1b1f21',
  'sideBar.border': '#f7f8f80f',
  'sideBarSectionHeader.background': '#1b1f21',
  'sideBarTitle.foreground': '#a0a2a3',
  'panel.background': '#1b1f21',
  'panel.border': '#f7f8f80f',
  'panelTitle.activeForeground': '#f7f8f8',
  'panelTitle.inactiveForeground': '#a0a2a3',
  'statusBar.background': '#121618',
  'statusBar.foreground': '#a0a2a3',
  'statusBar.noFolderBackground': '#121618',
  'titleBar.activeBackground': '#121618',
  'titleBar.activeForeground': '#f7f8f8',
  'titleBar.inactiveForeground': '#a0a2a3',
  // Editor chrome sits on markdown-code-block bluish-900 like harness code.
  'editor.background': '#171b1d',
  'editor.foreground': '#f7f8f8',
  'editor.lineHighlightBackground': '#f7f8f80a',
  'editor.selectionBackground': '#2e434bcc',
  'editorCursor.foreground': '#7bb4bc',
  'editorGroup.border': '#f7f8f81f',
  'editorGroupHeader.background': '#121618',
  'editorLineNumber.foreground': '#738484',
  'editorLineNumber.activeForeground': '#f7f8f8',
  'editorWidget.background': '#25292a',
  'editorWidget.border': '#f7f8f81f',
  // Tabs read like the harness tab strip: dark chip, active ink edge.
  'tab.activeBackground': '#171b1d',
  'tab.activeForeground': '#f7f8f8',
  'tab.activeBorderTop': '#7bb4bc',
  'tab.inactiveBackground': '#121618',
  'tab.inactiveForeground': '#a0a2a3',
  'tab.border': '#12161800',
  // Controls: brand accent is #7bb4bc; selections use multi-select slate.
  'focusBorder': '#7bb4bc',
  'badge.background': '#7bb4bc',
  'badge.foreground': '#121618',
  'button.background': '#2e434b',
  'button.foreground': '#f7f8f8',
  'button.hoverBackground': '#3d5963',
  'button.secondaryBackground': '#25292a',
  'button.secondaryForeground': '#f7f8f8',
  'dropdown.background': '#25292a',
  'dropdown.border': '#f7f8f81f',
  'input.background': '#1b1f21',
  'input.border': '#f7f8f81f',
  'list.activeSelectionBackground': '#2e434b',
  'list.activeSelectionForeground': '#f7f8f8',
  'list.focusBackground': '#2e434b',
  'list.hoverBackground': '#ffffff14',
  'list.inactiveSelectionBackground': '#2e434b99',
  'notification.background': '#25292a',
  'notification.border': '#f7f8f81f',
  'scrollbarSlider.background': '#ffffff1f',
  'scrollbarSlider.hoverBackground': '#ffffff29',
  'scrollbarSlider.activeBackground': '#ffffff38',
  'textLink.foreground': '#94c6cc',
  'textLink.activeForeground': '#7bb4bc',
  'widget.shadow': '#00000066',
  // Terminal adopts the editor well and the shiki-flavored ANSI row.
  'terminal.background': '#171b1d',
  'terminal.foreground': '#f7f8f8',
  'terminal.selectionBackground': '#2e434b',
  'terminalCursor.foreground': '#7bb4bc',
  'terminal.ansiBlue': '#61c8f9',
  'terminal.ansiGreen': '#60a5af',
  'terminal.ansiYellow': '#daa549',
  'terminal.ansiRed': '#d48b63',
  'terminal.ansiMagenta': '#ddc4d8',
  'terminal.ansiCyan': '#7bb4bc',
}

/** Syntax colors mirroring the harness shiki sheet. */
export const DO_TOKEN_COLORS: unknown = [
  { scope: 'comment', settings: { foreground: '#738484' } },
  { scope: 'keyword, keyword.control, storage', settings: { foreground: '#daa549' } },
  { scope: 'keyword.operator, punctuation', settings: { foreground: '#c5cdcd' } },
  { scope: 'string, string.quoted', settings: { foreground: '#60a5af' } },
  { scope: 'string.template, string.interpolated', settings: { foreground: '#c0dee1' } },
  { scope: 'constant, constant.numeric, support.constant', settings: { foreground: '#61c8f9' } },
  { scope: 'entity.name.function, support.function, meta.function-call', settings: { foreground: '#ddc4d8' } },
  { scope: 'entity.name.class, entity.name.type, support.class, entity.name.struct', settings: { foreground: '#61c8f9' } },
  { scope: 'variable.parameter', settings: { foreground: '#d48b63' } },
  { scope: 'variable.other.constant', settings: { foreground: '#61c8f9' } },
  { scope: 'markup.underline.link', settings: { foreground: '#94c6cc' } },
]

/**
 * The extension's `configurationDefaults`: the hushed-chrome and typography
 * row. Every key is user-overridable from the twin's own Settings UI — these
 * ride the registry default slot, never user storage.
 */
export const TWIN_CONFIGURATION_DEFAULTS: Record<string, unknown> = {
  'workbench.colorTheme': 'DO Harness Dark',
  // Chrome hush: no Welcome walkthrough, no second trust gate (the harness
  // sandbox owns trust), no telemetry or update prompts, calm window title.
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.enableExperiments': false,
  'security.workspace.trust.enabled': false,
  'security.workspace.trust.startupPrompt': 'never',
  'security.workspace.trust.banner': 'never',
  'window.title': '${dirty}${activeEditorShort}${separator}${rootName}',
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  // Typography: the harness code stack and size, sober line highlight.
  'editor.fontFamily': "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'",
  'editor.fontSize': 13,
  'editor.lineHeight': 1.5,
  'editor.minimap.enabled': false,
  'editor.renderLineHighlight': 'gutter',
  'terminal.integrated.fontFamily': "'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'",
  'terminal.integrated.fontSize': 13,
}

/** The pinned package.json staged into the twin's extensions dir. */
export function twinThemeManifest(): unknown {
  return {
    name: 'do-harness',
    publisher: 'dsh',
    displayName: 'DO Harness',
    description: 'DigitalOcean harness identity for the twin editor: the DO palette, fonts, and a hushed chrome.',
    version: TWIN_THEME_EXTENSION_VERSION,
    engines: { vscode: '^1.85.0' },
    categories: ['Themes'],
    contributes: {
      configurationDefaults: TWIN_CONFIGURATION_DEFAULTS,
      themes: [
        { label: 'DO Harness Dark', uiTheme: 'vs-dark', path: './themes/do-harness-dark-color-theme.json' },
      ],
    },
  }
}

/** The pinned theme JSON body staged beside the manifest. */
export function twinThemeFile(): unknown {
  return {
    $schema: 'vscode://schemas/color-theme',
    name: 'DO Harness Dark',
    type: 'dark',
    colors: DO_THEME_COLORS,
    tokenColors: DO_TOKEN_COLORS,
  }
}

/**
 * Stage the identity extension into the twin's `--extensions-dir`. Content is
 * harness-owned, so every spawn rewrites it bit-for-bit: upgrades land by
 * staging, user edits inside it are intentionally lost, and nothing outside
 * this directory is touched.
 * @param extensionsDir - the twin's `--extensions-dir` (`dist/.dsh/exts`).
 * @returns the staged extension directory path.
 */
export async function stageTwinTheme(extensionsDir: string): Promise<string> {
  const dir = join(extensionsDir, TWIN_THEME_DIR_NAME)
  await mkdir(join(dir, 'themes'), { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(twinThemeManifest(), null, 2)}\n`, 'utf8')
  await writeFile(join(dir, 'themes', 'do-harness-dark-color-theme.json'), `${JSON.stringify(twinThemeFile(), null, 2)}\n`, 'utf8')
  return dir
}
