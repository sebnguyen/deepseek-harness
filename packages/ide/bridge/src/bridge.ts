/**
 * Wire glue of the dsh-bridge extension: hello, the open downlink drain, and
 * the one-first-activation chrome posture. Pure over injected faces so the
 * skeleton tests run without a twin and the real entry wires `vscode` plus
 * loopback fetch at activation time.
 */

/** The `ide` namespace as the bridge consumes it from the ext-host. */
export interface IdeBridgeFace {
  hello(): Promise<boolean>
  openNext(): Promise<string | undefined>
}

/** The slice of the `vscode` API the glue drives. */
export interface VscodeGlueFace {
  executeOpen(path: string): Promise<void>
  updateSetting(key: string, value: unknown): Promise<void>
  runLayoutCommand(command: string): Promise<void>
}

/** Chrome-hiding defaults: settings are data, never workbench patches. */
export const CHROME_DEFAULTS = {
  'workbench.statusBar.visible': false,
  'window.menuBarVisibility': 'hidden',
  'workbench.startupEditor': 'none',
  'workbench.colorTheme': 'dsh-dark',
} as const satisfies Record<string, unknown>

/** Layout commands for chrome pieces settings no longer address at this pin. */
export const LAYOUT_HIDE_COMMANDS = [
  'workbench.action.toggleActivityBar',
  'workbench.action.closeSidebar',
  'workbench.action.closePanel',
] as const

/**
 * Activate the bridge glue: apply the posture once, hello the gateway, then
 * drain open requests until disposed.
 * @param vscodeApi - the ext-host face.
 * @param ide - the gateway face.
 * @param shouldDrain - polled each pump; false stops the loop gracefully.
 * @returns the disposer the extension host runs on deactivate.
 */
export async function activateBridge(
  vscodeApi: VscodeGlueFace,
  ide: IdeBridgeFace,
  shouldDrain: () => boolean = () => true,
): Promise<() => void> {
  for (const [key, value] of Object.entries(CHROME_DEFAULTS)) {
    await vscodeApi.updateSetting(key, value)
  }
  for (const command of LAYOUT_HIDE_COMMANDS) {
    await vscodeApi.runLayoutCommand(command)
  }
  await ide.hello()
  let stopped = false
  const pump = async (): Promise<void> => {
    while (!stopped && shouldDrain()) {
      const path = await ide.openNext()
      if (path === undefined) break
      await vscodeApi.executeOpen(path)
    }
  }
  void pump()
  return () => {
    stopped = true
  }
}
