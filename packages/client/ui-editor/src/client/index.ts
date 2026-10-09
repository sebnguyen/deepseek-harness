/**
 * Browser half: register `editor` as a right-Sidebar tab type.
 *
 * The type reaches the Sidebar through its public path only: the definition
 * into `ctx.sidebarRightTabs`, the body into the keyed
 * `sidebar.right.pane.tab` seat under the definition's `id`. It claims
 * session-scoped file addresses at the `builtin` band, ahead of the text
 * preview's `fallback` one. The file's metadata comes from the standard
 * `useResource`, served by the `file` provider; content and saves are this
 * type's own business, one `readAll` and one guarded `write` through the
 * `workspaceFiles` namespace.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type {} from '@deepseek-ai/dsh-checkpoint/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { ChangeMarkers } from './change-markers.tsx'
import { EditorBody, type EditorInjected } from './EditorBody.tsx'
import { EDITOR_ID, editorDefinition } from './definition.ts'
import { en, zh } from './locales.ts'
import type { EditorFilesRemote } from './rpc.ts'

export type {
  EditorAnnotationOwner, EditorCmEntryInjected, EditorGutterDescriptor, EditorGutterMarker,
  EditorRuntimeModules,
} from './contract/slots.ts'
export type { EditorDoors } from './runtime.ts'
export { annotationGutter, gutterMarkersField, setGutterMarkers } from './annotations.ts'
export type { EditorKey } from './locales.ts'
export type { EditorBodyProps, EditorInjected } from './EditorBody.tsx'
export type { EditorFilesRemote, SessionFile } from './rpc.ts'
export { EDITOR_ID, EDITOR_KIND, basenameOf, editorDefinition } from './definition.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File-editor banner, footer, status, and failure lines. */
    editor: import('./locales.ts').EditorKey
  }
}

/**
 * Required browser services: the tab registry, the slots, copy, and the Remote
 * carrier with its `workspaceFiles` namespace.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles', 'remote.checkpoint']

/**
 * Client plugin body: register the type, its dictionaries, and its body.
 * @param ctx - client root context carrying the registry, the slots, copy, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const remote = ctx.remote as EditorFilesRemote
  const face: EditorInjected = {
    load: (file, signal) => remote.workspaceFiles.readAll(file.sessionId, file.path, signal),
    save: (file, content, expectedVersion, signal) =>
      remote.workspaceFiles.write(file.sessionId, file.path, content, expectedVersion, signal),
    blob: (file, digest) => remote.checkpoint.blob(file.sessionId, digest),
    restore: (file, digest) => remote.checkpoint.restore(file.sessionId, file.path, digest),
  }
  ctx.effect(() => ctx.sidebarRightTabs.register(editorDefinition()), 'ui-editor: editor type')
  ctx.effect(() => ctx.locale.register('editor', { zh, en }), 'ui-editor: dictionaries')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: EDITOR_ID,
      locale: 'editor',
      inject: (): EditorInjected => face,
      children: {
        'editor.annotation': { kind: 'list', scope: 'session' },
      },
    },
    EditorBody,
  )), 'ui-editor: editor body')
  ctx.effect(() => ctx.slots.inject('editor.annotation', () => ctx.slots.register(
    {
      name: 'editor.annotation',
      id: 'editor-change-markers',
      order: 10,
    },
    ChangeMarkers,
  )), 'ui-editor: change markers')
}
