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
 * code colors, so the editor and the harness page read as one product. Inter
 * is the workbench UI face (bundled in the fork); JetBrains Mono is the editor
 * and terminal face set below.
 * @module @deepseek-ai/dsh-api-ide/twin-theme
 */

import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The staged extension's stable directory name inside `--extensions-dir`. */
export const VSCODE_THEME_EXTENSION_ID = 'dsh.do-harness'
export const VSCODE_THEME_EXTENSION_VERSION = '0.0.1'
export const VSCODE_THEME_DIR_NAME = `${VSCODE_THEME_EXTENSION_ID}-${VSCODE_THEME_EXTENSION_VERSION}`

/** Workbench colors, walking the harness bluish scale like the app chrome. */
export const DO_THEME_COLORS: Record<string, string> = {
  // Base ink for every widget the sub-grounds don't paint explicitly.
  'foreground': '#f7f8f8',
  'descriptionForeground': '#a2a4a5',
  'icon.foreground': '#f7f8f8',
  // App shell backgrounds walk the bluish scale 950→875 like the harness page.
  'activityBar.background': '#121618',
  'activityBar.foreground': '#f7f8f8',
  'activityBar.inactiveForeground': '#87898a',
  'activityBarBadge.background': '#7bb4bc',
  'activityBarBadge.foreground': '#121618',
  'editorGroupHeader.tabsBackground': '#121618',
  'minimap.background': '#121618',
  'sideBar.background': '#171c1e',
  'sideBar.border': '#ffffff14',
  'sideBarSectionHeader.background': '#171c1e',
  'sideBarTitle.foreground': '#a2a4a5',
  'panel.background': '#171c1e',
  'panel.border': '#ffffff14',
  'panelTitle.activeForeground': '#f7f8f8',
  'panelTitle.inactiveForeground': '#a2a4a5',
  'statusBar.background': '#121618',
  'statusBar.foreground': '#a2a4a5',
  'statusBar.noFolderBackground': '#121618',
  'titleBar.activeBackground': '#121618',
  'titleBar.activeForeground': '#f7f8f8',
  'titleBar.inactiveForeground': '#a2a4a5',
  // The shell is one ruled sheet now: the react frame and this workbench are
  // flush regions separated by hairlines, so the fork's floating-card mode
  // (glass gutters over the harness ocean) is off, and widgets cast nothing.
  'modernUI.shellBackground': '#121618',
  'modernUI.inactiveShellBackground': '#121618',
  'surface.border': '#ffffff14',
  // Editor chrome sits on markdown-code-block bluish-900 like harness code.
  'editor.background': '#171c1e',
  'editor.foreground': '#f7f8f8',
  'editor.lineHighlightBackground': '#f7f8f80a',
  'editor.selectionBackground': '#2e434bcc',
  'editorCursor.foreground': '#7bb4bc',
  'editorGroup.border': '#ffffff14',
  'editorGroupHeader.background': '#121618',
  'editorLineNumber.foreground': '#738484',
  'editorLineNumber.activeForeground': '#f7f8f8',
  'editorWidget.background': '#252a2b',
  'editorWidget.border': '#ffffff14',
  'editorStickyScroll.background': '#121618',
  'breadcrumb.background': '#121618',
  'peekViewEditor.background': '#202426',
  // Tabs read like the harness tab strip: dark chip, active ink edge.
  'tab.activeBackground': '#171c1e',
  'tab.activeForeground': '#f7f8f8',
  'tab.activeBorderTop': '#7bb4bc80',
  'tab.inactiveBackground': '#121618',
  'tab.inactiveForeground': '#a2a4a5',
  'tab.border': '#12161800',
  // Controls: brand accent is #7bb4bc — rings ride it at half alpha, closer
  // to the harness hairline than the stock heavy outline.
  'focusBorder': '#7bb4bc80',
  'badge.background': '#7bb4bc',
  'badge.foreground': '#121618',
  'button.background': '#2e434b',
  'button.foreground': '#f7f8f8',
  'button.hoverBackground': '#3d5963',
  'button.secondaryBackground': '#252a2b',
  'button.secondaryForeground': '#f7f8f8',
  'dropdown.background': '#252a2b',
  'dropdown.border': '#ffffff14',
  'input.background': '#171c1e',
  'input.border': '#ffffff14',
  'menu.background': '#252a2b',
  'menu.border': '#ffffff14',
  'menu.foreground': '#f7f8f8',
  'quickInput.background': '#252a2b',
  'list.activeSelectionBackground': '#2e434b',
  'list.activeSelectionForeground': '#f7f8f8',
  'list.focusBackground': '#2e434b',
  'list.hoverBackground': '#ffffff14',
  'list.inactiveSelectionBackground': '#2e434b99',
  'notification.background': '#252a2b',
  'notification.border': '#ffffff14',
  'scrollbarSlider.background': '#ffffff1f',
  'scrollbarSlider.hoverBackground': '#ffffff29',
  'scrollbarSlider.activeBackground': '#ffffff38',
  'textLink.foreground': '#94c6cc',
  'textLink.activeForeground': '#7bb4bc',
  'widget.shadow': 'transparent',
  // Terminal adopts the editor well and the shiki-flavored ANSI row.
  'terminal.background': '#171c1e',
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
  // One ruled sheet: the stock workbench layout (no floating cards). The
  // harness frame around the twin is flush, so glass gutters would read as a
  // hole rather than as depth.
  'workbench.experimental.modernUI': false,
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
  // No chat in the twin: the harness IS the conversation. The master kill
  // hides the pane + inline hint; the agents pill and the empty auxiliary
  // bar are their own settings and need these two besides.
  'chat.disableAIFeatures': true,
  'chat.agentsControl.enabled': 'hidden',
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  // Tree hugs the frame's left edge like stock vscode: sidebar rides left —
  // position is stored UI state there, so `extension.cjs` fires the
  // deterministic command once per profile instead of a setting here.
  'workbench.sideBar.location': 'left', // deprecated to UI state; see TWIN_EXTENSION_BOOT
  // Typography: the harness code stack and size, sober line highlight.
  'editor.fontFamily': "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'",
  'editor.fontSize': 13,
  'editor.lineHeight': 1.5,
  'editor.minimap.enabled': false,
  'editor.renderLineHighlight': 'gutter',
  'terminal.integrated.fontFamily': "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei'",
  'terminal.integrated.fontSize': 13,
}

/** The pinned package.json staged into the twin's extensions dir. */
export function twinThemeManifest(): unknown {
  return {
    name: 'do-harness',
    publisher: 'dsh',
    displayName: 'DO Harness',
    description: 'DigitalOcean harness identity for the twin editor: the DO palette, fonts, and a hushed chrome.',
    version: VSCODE_THEME_EXTENSION_VERSION,
    engines: { vscode: '^1.85.0' },
    categories: ['Themes'],
    main: './extension.cjs',
    activationEvents: ['onStartupFinished'],
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
/** The identity contract lives with the other wire contracts in `./types.ts`. */
import type { VscodeBridgeIdentity } from './types.ts'
export type { VscodeBridgeIdentity }

/** Filename the bridge extension looks up at activation (`__dirname/../../bridge.json`). */
export const TWIN_BRIDGE_IDENTITY_BASENAME = 'bridge.json'

/** The staged bridge extension's directory name inside the twin `exts/` dir. */
export const TWIN_BRIDGE_EXTENSION_DIR_NAME = 'dsh-do-harness-bridge'

/** The bridge extension's vscode identifier (`publisher.name`). */
export const TWIN_BRIDGE_EXTENSION_ID = 'dsh.do-harness-bridge'

/** Repo-local path of the compiled bridge bundle, produced by the workspace client build. */
function twinBridgeBundlePath(): string {
  return resolve(
    fileURLToPath(import.meta.url),
    '..', '..', '..', '..',
    'extensions', 'vscode-cordis',
    'dist-extension',
    'extension.cjs',
  )
}

function twinBridgeManifest(): Record<string, unknown> {
  return {
    name: 'do-harness-bridge',
    publisher: 'dsh',
    version: '0.1.0',
    engines: { vscode: '^1.50.0' },
    main: './extension.cjs',
    // The timeline plane calls window.registerTimelineProvider, and this
    // vscode fork guards that surface behind the 'timeline' proposed API:
    // checkProposedApiEnabled reads this property verbatim. The plane layer
    // is local-only, so declaring the proposal in the staged manifest is the
    // product-safe way to admit it.
    enabledApiProposals: ['timeline'],
    activationEvents: ['onStartupFinished'],
    contributes: {
      // The planes mount these handlers at runtime through the seat's facade;
      // the manifest contribution is only what makes the commands discoverable
      // in the palette (planes are bundles, their own package.json never
      // reaches the workbench).
      commands: [
        { command: 'do-harness.addLineNote', title: 'Add Line Note', category: 'DSH Harness' },
        { command: 'do-harness.timeline.open', title: 'Open Checkpoint Timeline', category: 'DSH Harness' },
      ],
    },
  }
}

/**
 * Stage the compiled connection bridge beside the theme extension when the
 * workspace build produced it. Absent (no client build yet / bundle miss),
 * the twin launches with theme only and no error — file forwarding stays
 * unavailable until a build lands, matching the extension's idle nature.
 * @param extensionsDir - the twin's `--extensions-dir` (`dist/.dsh/exts`).
 * @param bundlePath - explicit bundle to stage; resolved repo-locally by default.
 * @returns the staged extension dir, or null when the bundle wasn't yet built.
 */
export async function stageVscodeBridgeExtension(
  extensionsDir: string,
  bundlePath?: string,
): Promise<string | null> {
  const bundle = bundlePath ?? twinBridgeBundlePath()
  if (!existsSync(bundle)) return null
  const dir = join(extensionsDir, TWIN_BRIDGE_EXTENSION_DIR_NAME)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(twinBridgeManifest(), null, 2)}\n`, 'utf8')
  await copyFile(bundle, join(dir, 'extension.cjs'))
  return dir
}

/** Proposed APIs the seat's planes are sanctioned to exercise on the twin. */
export const TWIN_PROPOSED_APIS = ['timeline'] as const

/**
 * Admission for the timeline plane: the vscode fork ships
 * `window.registerTimelineProvider` behind the `timeline` proposed API, and
 * its extension scanner drops `package.json.enabledApiProposals` from any
 * extension not allow-listed in the deployment's own product.json. The twin
 * dist is the harness's private fork build, so stamping the bridge id into
 * the product's `extensionEnabledApiProposals` map is the sanctioned route —
 * the same one vscode itself uses for its built-ins. Idempotent: absent
 * product.json (a dist half-staged) or a map already carrying the id,
 * the write is skipped.
 * @param productPath - the twin dist's `product.json`.
 */
export async function stageTwinProposedApis(productPath: string): Promise<void> {
  if (!existsSync(productPath)) return
  const raw = JSON.parse(await readFile(productPath, 'utf8')) as Record<string, unknown>
  const prior = (['object', 'function'].includes(typeof raw.extensionEnabledApiProposals)
    ? raw.extensionEnabledApiProposals
    : {}) as Record<string, unknown>
  const owned = new Set([...(Array.isArray(prior[TWIN_BRIDGE_EXTENSION_ID]) ? (prior[TWIN_BRIDGE_EXTENSION_ID] as string[]) : [])])
  if (TWIN_PROPOSED_APIS.every(api => owned.has(api))) return
  for (const api of TWIN_PROPOSED_APIS) owned.add(api)
  raw.extensionEnabledApiProposals = {
    ...prior,
    [TWIN_BRIDGE_EXTENSION_ID]: Object.freeze([...owned].sort()),
  }
  await writeFile(productPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
}

/**
 * Stage the bridge identity beside the twin's state dirs.
 * @param stateDir - the twin-local `.dsh` dir (parent of `exts/`, `user/`, `server/`).
 * @param identity - spawn-resolved facts.
 */
export async function stageVscodeBridgeIdentity(stateDir: string, identity: VscodeBridgeIdentity): Promise<void> {
  await writeFile(
    join(stateDir, TWIN_BRIDGE_IDENTITY_BASENAME),
    `${JSON.stringify(identity, null, 2)}\n`,
    'utf8',
  )
}

export async function stageTwinTheme(extensionsDir: string): Promise<string> {
  const dir = join(extensionsDir, VSCODE_THEME_DIR_NAME)
  await mkdir(join(dir, 'themes'), { recursive: true })
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(twinThemeManifest(), null, 2)}\n`, 'utf8')
  await writeFile(join(dir, 'themes', 'do-harness-dark-color-theme.json'), `${JSON.stringify(twinThemeFile(), null, 2)}\n`, 'utf8')
  await writeFile(join(dir, 'extension.cjs'), TWIN_EXTENSION_BOOT, 'utf8')
  return dir
}

/**
 * The one-once layout nudge: side bar lives as stored UI state (not config),
 * so configuration defaults cannot put it right — a deterministic command
 * can. Fires once per user profile; later manual moves are theirs again.
 */
export const TWIN_EXTENSION_BOOT = String.raw`'use strict';
const vscode = require('vscode')

function activate(context) {
  if (context.globalState.get('dsh.do-harness.sideBarLeft') === true) return
  void vscode.commands.executeCommand('workbench.action.moveSideBarLeft')
  void context.globalState.update('dsh.do-harness.sideBarLeft', true)
}

module.exports = { activate }
`
