/**
 * The frame tab's body: an iframe of the loopback editor plane, fed by the
 * `ide` readiness stream. The registry only routes a claim here while ready,
 * so the absent branch is the degrade-in-flight posture, not a cold one.
 */
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { sessionFileOf, type IdeClientFace, type IdeWireStatus } from './rpc.ts'
import type { VscodeKey } from './locales.ts'

/** The slot-rendered props: the tab-info hook, copy, and the injected wire face. */
export interface VscodeBodyProps {
  useTabInfo(): { readonly tab: { readonly contentId: string } }
  t(key: VscodeKey): string
  ide: IdeClientFace
}

/**
 * Render the frame for one claimed address.
 * @param props - slot-rendered hooks and the injected `ide` face.
 * @returns the iframe once ready, the loading or absent line before it.
 */
export function VscodeBody({ useTabInfo, t, ide }: VscodeBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const [status, setStatus] = useState<IdeWireStatus | undefined>()
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      for await (const next of ide.events(controller.signal)) setStatus(next)
    })()
    return () => controller.abort()
  }, [ide, tab.contentId])
  const ready = status?.ready === true
  const path = sessionFileOf(tab.contentId).path
  useEffect(() => {
    if (ready) void ide.open(path, AbortSignal.none)
  }, [ready, ide, path])
  if (status === undefined) return <div role="status">{t('loading')}</div>
  if (!ready || status.frameUrl === undefined) return <div role="status">{t('absent')}</div>
  return <iframe title={t('frame')} src={status.frameUrl} style={{ width: '100%', height: '100%', border: 0 }} />
}
