/**
 * The editor tab's body: one CodeMirror 6 view over the addressed file.
 *
 * Two sources meet here, as in the read-only preview: the standard
 * `useResource` hook carries the file's freshness version, and this type's own
 * face carries the text and the version a save guards. Unlike the preview, a
 * save names that version, so Ctrl/Cmd-S either lands or reports
 * `workspace-file/stale`; the conflict banner then offers reload (discard the
 * buffer) or overwrite (save against the fresh version). An external change is
 * announced only while the buffer is dirty: a clean buffer silently reloads on
 * the next open.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type { WorkspaceFileBytes, WorkspaceFileStat } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { createEditorExtensions, languageFor } from './editor.ts'
import { decodeText, failureLine, sessionFileOf, type SessionFile } from './rpc.ts'
import css from './EditorBody.module.css'

/** The Remote operations one body performs, injected so the component stays host-free. */
export interface EditorInjected {
  /** Read the complete file the tab addresses. */
  readonly load: (file: SessionFile, signal: AbortSignal) => Promise<RemoteResult<WorkspaceFileBytes>>
  /** Save the given text under a version guard. */
  readonly save: (
    file: SessionFile,
    content: string,
    expectedVersion: string | undefined,
    signal: AbortSignal,
  ) => Promise<RemoteResult<WorkspaceFileStat>>
}

/** The body's composed props: the tab, the injected face, and copy. */
export type EditorBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<EditorInjected>
  & PropsLocale<'editor'>

/** One loaded document generation; each reload or replace builds a new editor view. */
interface LoadedDocument {
  readonly text: string
  readonly version: string
  readonly key: number
}

/** The banner's two moods: the version moved under a dirty buffer, or one failure line. */
type Banner =
  | { readonly kind: 'conflict' }
  | { readonly kind: 'message'; readonly text: string }

/**
 * The editor type's body, registered under `sidebar.right.pane.tab`.
 * @param props - composed slot props.
 * @returns the editor with its banner and status row.
 */
export function EditorBody({ useTabInfo, useResource, load, save, t }: EditorBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const meta = useResource<'file'>(tab.contentId)
  const file = useMemo(() => sessionFileOf(tab.contentId), [tab.contentId])
  const [doc, setDoc] = useState<LoadedDocument | undefined>(undefined)
  const [failed, setFailed] = useState<string | undefined>(undefined)
  const [banner, setBanner] = useState<Banner | undefined>(undefined)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const loadedRef = useRef<{ text: string; version: string } | undefined>(undefined)
  const viewRef = useRef<EditorView | undefined>(undefined)
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setFailed(undefined)
    setBanner(undefined)
    setDirty(false)
    setDoc(undefined)
    loadedRef.current = undefined
    void load(file, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) {
        setFailed(failureLine(t, result.error))
        return
      }
      const text = decodeText(result.value)
      loadedRef.current = { text, version: result.value.version }
      setDoc({ text, version: result.value.version, key: Date.now() })
    })
    return () => {
      controller.abort()
    }
  }, [file, load, reloadKey, t])

  const runSave = useCallback((expectedVersion: string | undefined, guarded: boolean): void => {
    const view = viewRef.current
    const loaded = loadedRef.current
    if (view === undefined || loaded === undefined || saving) return
    const text = view.state.doc.toString()
    const fallback = guarded ? loaded.version : undefined
    setSaving(true)
    void save(file, text, expectedVersion ?? fallback, new AbortController().signal).then((result) => {
      setSaving(false)
      if (!result.ok) {
        if (result.error.code === 'workspace-file/stale') {
          setBanner(previous => (previous?.kind === 'conflict' ? previous : { kind: 'conflict' }))
        }
        else setBanner({ kind: 'message', text: failureLine(t, result.error) })
        return
      }
      loadedRef.current = { text, version: result.value.version }
      setDirty(false)
      setBanner(undefined)
    })
  }, [file, save, saving, t])

  /** The Mod-S entry point: guard against the version this buffer was loaded from. */
  const guardedSave = useCallback((): void => {
    runSave(undefined, true)
  }, [runSave])

  useEffect(() => {
    const host = hostRef.current
    if (doc === undefined || host === null) return undefined
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: doc.text,
        extensions: [
          ...createEditorExtensions(guardedSave, languageFor(file.path)),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            const loaded = loadedRef.current
            setDirty(loaded === undefined || update.state.doc.toString() !== loaded.text)
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      viewRef.current = undefined
      view.destroy()
    }
  }, [doc, file.path, guardedSave, runSave])

  // A Host-reported version change means something else wrote the file; a clean
  // buffer silently reloads on next open, a dirty one gets the banner.
  useEffect(() => {
    const fresh = meta.status === 'live' ? meta.value?.version : undefined
    const loaded = loadedRef.current
    if (dirty && fresh !== undefined && loaded !== undefined && fresh !== loaded.version) {
      setBanner(previous => (previous?.kind === 'conflict' ? previous : { kind: 'conflict' }))
    }
  }, [meta, dirty])

  const freshVersion = meta.status === 'live' ? meta.value?.version : undefined
  const status = saving ? t('saving') : dirty ? t('unsaved') : doc === undefined ? t('loading') : t('saved')
  return (
    <div className={css.root}>
      {banner !== undefined && (
        <div className={css.banner}>
          <span className={css.bannerText}>{banner.kind === 'conflict' ? t('conflict') : banner.text}</span>
          {banner.kind === 'conflict' && (
            <>
              <button type="button" onClick={() => { setReloadKey(key => key + 1) }}>{t('reload')}</button>
              <button type="button" onClick={() => { runSave(freshVersion, false) }}>{t('overwrite')}</button>
            </>
          )}
        </div>
      )}
      {failed !== undefined
        ? <div className={css.error}>{failed}</div>
        : <div className={css.host} ref={hostRef} />}
      {failed === undefined && (
        <div className={css.footer}>
          <span className={css.status}>{status}</span>
          <button type="button" disabled={!dirty || saving} onClick={() => { runSave(undefined, true) }}>{t('save')}</button>
          <button type="button" disabled={saving || doc === undefined} onClick={() => { setReloadKey(key => key + 1) }}>
            {t('revert')}
          </button>
        </div>
      )}
    </div>
  )
}
