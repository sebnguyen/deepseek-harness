/** Read-only global panel for Host and browser Cordis Context/Fiber trees. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  CordisRuntimeFiber,
  CordisRuntimeNode,
  CordisRuntimeRealm,
  CordisRuntimeSourceId,
} from '@deepseek-ai/dsh-experimental-inspector/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button, IconBranchOutline16, IconRefreshOutline16, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { InspectorTreeSource } from './tree-source.ts'
import { filterCordisRuntimeTree, type CordisRealmFilter } from './filter-tree.ts'
import { runtimeFiberByUid, type CordisServiceSelection } from './service-selection.ts'
import type { CordisServicePreviewController, CordisServicePreviewState } from './service-preview.ts'
import css from './CordisTreePanel.module.css'

/** Registration-side face for the runtime tree. */
export interface CordisTreePanelInjected {
  hooks: {
    inspection: InspectorTreeSource
    preview: CordisServicePreviewController
  }
  /** Query the Worker immediately, retaining single-flight behavior. */
  onRefresh(): void
  /** Resolve and display the currently selected service. */
  onSelectService(selection: CordisServiceSelection): void
  /** Close the current preview and supersede any outstanding query. */
  onClosePreview(): void
}

/** Props assembled by the root-scoped main-slot renderer. */
export type CordisTreePanelProps =
  PropsRuntime<'main'>
  & PropsLocale<'experimental-inspector'>
  & InjectFace<CordisTreePanelInjected>

type Translate = CordisTreePanelProps['t']

interface TreeNodeProps {
  readonly node: CordisRuntimeNode
  readonly depth: number
  readonly sourceId: CordisRuntimeSourceId
  readonly focusedKey: string | null
  readonly onSelect: (selection: CordisServiceSelection) => void
  readonly t: Translate
}

const STATE_TONES = {
  pending: 'warning',
  loading: 'info',
  active: 'success',
  failed: 'danger',
  disposed: 'neutral',
  unloading: 'warning',
} as const satisfies Record<CordisRuntimeFiber['state'], TagTone>

interface FiberDetailsProps {
  readonly node: CordisRuntimeFiber
  readonly sourceId: CordisRuntimeSourceId
  readonly onSelect: (selection: CordisServiceSelection) => void
  readonly t: Translate
}

/** Display scalar identity, dependencies, and service ownership without opaque values. */
function FiberDetails({ node, sourceId, onSelect, t }: FiberDetailsProps): ReactNode {
  return (
    <dl className={css.fiberDetails}>
      <div>
        <dt>{t('pluginName')}</dt>
        <dd title={node.pluginName ?? undefined}>{node.pluginName ?? t('anonymousPlugin')}</dd>
      </div>
      {node.entryName === null ? null : (
        <div><dt>{t('entryName')}</dt><dd title={node.entryName}>{node.entryName}</dd></div>
      )}
      <div>
        <dt>{t('inject')}</dt>
        <dd>{node.inject.length === 0 ? t('injectEmpty') : node.inject.join(', ')}</dd>
      </div>
      <div>
        <dt>{t('store')}</dt>
        <dd>
          {node.store === null ? t('storeUnloaded') : node.store.length === 0 ? t('storeEmpty') : (
            <ul className={css.serviceList}>
              {node.store.map((entry) => {
                if (entry.providerUid === null) {
                  return <li key={entry.name}><code>{t('providerDisposed', { name: entry.name })}</code></li>
                }
                const providerUid = entry.providerUid
                return (
                  <li key={entry.name}>
                    <button
                      type="button"
                      className={css.providerLink}
                      aria-label={t('focusProvider', { name: entry.name, uid: providerUid })}
                      onClick={() => { onSelect({
                        kind: 'injected',
                        sourceId,
                        name: entry.name,
                        consumerUid: node.uid,
                        providerUid,
                      }) }}
                    >
                      <code>{t('providerLink', { name: entry.name, uid: providerUid })}</code>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </dd>
      </div>
      <div>
        <dt>{t('provides')}</dt>
        <dd>
          {node.provides.length === 0 ? t('providesEmpty') : (
            <ul className={css.serviceList}>
              {node.provides.map((name, index) => {
                const occurrences = node.provides.filter(candidate => candidate === name).length
                const ordinal = node.provides.slice(0, index).filter(candidate => candidate === name).length
                return (
                  <li key={`${name}:${String(ordinal)}`}>
                    <button
                      type="button"
                      className={css.providerLink}
                      aria-label={t('focusProvider', { name, uid: node.uid })}
                      onClick={() => { onSelect({
                        kind: 'provided',
                        sourceId,
                        name,
                        providerUid: node.uid,
                        ordinal,
                        occurrences,
                      }) }}
                    >
                      <code>{name}</code>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </dd>
      </div>
    </dl>
  )
}

/** Render a Fiber followed by its owned Context, or one Context prototype layer. */
function TreeNode({ node, depth, sourceId, focusedKey, onSelect, t }: TreeNodeProps): ReactNode {
  if (node.kind === 'fiber') {
    const identity = node.entryName ?? node.pluginName ?? t('anonymousPlugin')
    return (
      <li>
        <details open>
          <summary
            className={`${css.nodeRow} ${css.fiberRow}`}
            data-fiber-key={`${sourceId}:${String(node.uid)}`}
            data-focused={focusedKey === `${sourceId}:${String(node.uid)}` ? 'true' : undefined}
            tabIndex={-1}
          >
            <strong className={css.pluginName} title={identity}>{identity}</strong>
            <code className={css.fiber}>{t('fiber', { uid: node.uid })}</code>
            <Tag tone={STATE_TONES[node.state]}>{t(`state.${node.state}`)}</Tag>
          </summary>
          <FiberDetails node={node} sourceId={sourceId} onSelect={onSelect} t={t} />
          <ul className={css.children}>
            <TreeNode node={node.children[0]} depth={depth + 1} sourceId={sourceId} focusedKey={focusedKey} onSelect={onSelect} t={t} />
          </ul>
        </details>
      </li>
    )
  }
  if (node.children.length === 0) {
    return <li className={css.leaf}><code className={css.context}>{t('context')}</code></li>
  }
  return (
    <li>
      <details open>
        <summary className={css.nodeRow}><code className={css.context}>{t('context')}</code></summary>
        <ul className={css.children}>
          {node.children.map((child, index) => (
            <TreeNode key={index} node={child} depth={depth + 1} sourceId={sourceId} focusedKey={focusedKey} onSelect={onSelect} t={t} />
          ))}
        </ul>
      </details>
    </li>
  )
}

interface RealmTreeProps {
  readonly realm: CordisRuntimeRealm
  readonly hideEmpty: boolean
  readonly focusedKey: string | null
  readonly onSelect: (selection: CordisServiceSelection) => void
  readonly t: Translate
}

/** Render one source's revision, connection state, truncation, and complete reachable tree. */
function RealmTree({ realm, hideEmpty, focusedKey, onSelect, t }: RealmTreeProps): ReactNode {
  const connected = realm.connection.state === 'connected'
  const status = connected
    ? t('connected')
    : realm.connection.reason.length > 0
      ? t('disconnectedReason', { reason: realm.connection.reason })
      : t('disconnected')
  return (
    <article className={css.realm} data-connected={connected}>
      <header className={css.realmHeader}>
        <strong className={css.sourceLabel}>{realm.source.label}</strong>
        <span className={css.connection} data-connected={connected}>{status}</span>
        <span className={css.revision}>{t('revision', { revision: realm.revision })}</span>
      </header>
      {realm.truncated ? <p className={css.notice} role="note">{t('truncated')}</p> : null}
      {hideEmpty && realm.root.children.length === 0
        ? <p className={css.empty} role="status">{t('noVisibleFibers')}</p>
        : (
          <ul className={css.tree}>
            <TreeNode node={realm.root} depth={0} sourceId={realm.source.sourceId} focusedKey={focusedKey} onSelect={onSelect} t={t} />
          </ul>
        )}
    </article>
  )
}

interface ServicePreviewPaneProps {
  readonly state: CordisServicePreviewState
  readonly onClose: () => void
  readonly t: Translate
}

/** Present one explicitly selected service without evaluating its value in React. */
function ServicePreviewPane({ state, onClose, t }: ServicePreviewPaneProps): ReactNode {
  if (state === null) return null
  return (
    <aside className={css.previewPane} aria-label={t('servicePreviewTitle', { name: state.selection.name })}>
      <header className={css.previewHeader}>
        <strong>{t('servicePreviewTitle', { name: state.selection.name })}</strong>
        <Button size="sm" onClick={onClose}>{t('previewClose')}</Button>
      </header>
      {state.status === 'loading' ? <p className={css.empty} role="status">{t('previewLoading')}</p> : null}
      {state.status === 'error' ? <p className={css.error} role="alert">{t('previewFailed', { message: state.message })}</p> : null}
      {state.status === 'ready' && state.preview.kind === 'json'
        ? <pre className={css.previewValue}>{JSON.stringify(state.preview.value, null, 2)}</pre>
        : null}
      {state.status === 'ready' && state.preview.kind === 'summary'
        ? <p className={css.empty}>{state.preview.text}</p>
        : null}
    </aside>
  )
}

const REALM_CHOICES = [
  { id: 'all', localeKey: 'realmAll' },
  { id: 'host', localeKey: 'realmHost' },
  { id: 'client', localeKey: 'realmClients' },
] as const

/** Display the latest Host and Client snapshots and refresh them on demand. */
export function CordisTreePanel({
  useInspection,
  usePreview,
  onRefresh,
  onSelectService,
  onClosePreview,
  t,
}: CordisTreePanelProps): ReactNode {
  const snapshot = useInspection(value => value)
  const previewState = usePreview(value => value)
  const tree = snapshot.tree
  const [realmFilter, setRealmFilter] = useState<CordisRealmFilter>('all')
  const [hideEmpty, setHideEmpty] = useState(false)
  const [selected, setSelected] = useState<(CordisServiceSelection & { attempt: number }) | null>(null)
  const [providerUnavailable, setProviderUnavailable] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const retryProvider = useRef(false)
  const filteredTree = useMemo(() => tree === null
    ? null
    : filterCordisRuntimeTree(tree, realmFilter, hideEmpty), [tree, realmFilter, hideEmpty])
  const focusedKey = selected === null ? null : `${selected.sourceId}:${String(selected.providerUid)}`
  const selectProvider = (selection: CordisServiceSelection): void => {
    retryProvider.current = false
    setProviderUnavailable(false)
    setSelected(previous => ({ ...selection, attempt: (previous?.attempt ?? -1) + 1 }))
    onSelectService(selection)
  }

  useEffect(() => {
    if (selected === null) return
    const target = [...(panelRef.current?.querySelectorAll<HTMLElement>('summary[data-fiber-key]') ?? [])]
      .find(summary => summary.getAttribute('data-fiber-key') === focusedKey)
    if (target !== undefined) {
      let parent = target.parentElement
      while (parent !== null && parent !== panelRef.current) {
        if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true
        parent = parent.parentElement
      }
      target.focus()
      if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'nearest' })
      retryProvider.current = false
      setProviderUnavailable(false)
      return
    }
    const realm = tree?.host?.source.sourceId === selected.sourceId
      ? tree.host
      : tree?.clients.find(candidate => candidate.source.sourceId === selected.sourceId)
    if (runtimeFiberByUid(realm?.root, selected.providerUid) !== undefined && !retryProvider.current) {
      retryProvider.current = true
      setHideEmpty(false)
      setRealmFilter('all')
      return
    }
    retryProvider.current = false
    setProviderUnavailable(true)
  }, [selected, filteredTree, tree, focusedKey])

  return (
    <section ref={panelRef} className={css.panel} aria-label={t('title')}>
      <header className={css.header}>
        <div className={css.heading}>
          <h1>{t('title')}</h1>
          <p>{t('subtitle')}</p>
        </div>
        <Button size="sm" icon={<IconRefreshOutline16 />} onClick={onRefresh}>{t('refresh')}</Button>
      </header>
      <div className={css.controls}>
        <div className={css.filterGroup} role="group" aria-label={t('realmFilter')}>
          {REALM_CHOICES.map(choice => (
            <Button
              key={choice.id}
              size="sm"
              variant={realmFilter === choice.id ? 'primary' : 'ghost'}
              aria-pressed={realmFilter === choice.id}
              onClick={() => { setRealmFilter(choice.id) }}
            >
              {t(choice.localeKey)}
            </Button>
          ))}
        </div>
        <label className={css.filterToggle}>
          <input type="checkbox" checked={hideEmpty} onChange={(event) => { setHideEmpty(event.target.checked) }} />
          {t('hideEmpty')}
        </label>
      </div>
      {snapshot.error === undefined ? null : <p className={css.error} role="alert">{t('readFailed', { message: snapshot.error })}</p>}
      {!providerUnavailable || selected === null ? null : (
        <p className={css.empty} role="status">{t('providerUnavailable', { uid: selected.providerUid })}</p>
      )}
      <ServicePreviewPane state={previewState} onClose={onClosePreview} t={t} />
      {tree !== null && filteredTree !== null ? (
        <div className={css.realms}>
          {realmFilter === 'client' ? null : (
            <section className={css.realmGroup}>
              <h2>{t('host')}</h2>
              {filteredTree.host === null ? <p className={css.empty}>{t('noHost')}</p> : (
                <RealmTree realm={filteredTree.host} hideEmpty={hideEmpty} focusedKey={focusedKey} onSelect={selectProvider} t={t} />
              )}
            </section>
          )}
          {realmFilter === 'host' ? null : (
            <section className={css.realmGroup}>
              <h2>{t('clients')}</h2>
              {filteredTree.clients.length === 0
                ? <p className={css.empty}>{t('noClients')}</p>
                : filteredTree.clients.map(realm => (
                  <RealmTree
                    key={realm.source.sourceId}
                    realm={realm}
                    hideEmpty={hideEmpty}
                    focusedKey={focusedKey}
                    onSelect={selectProvider}
                    t={t}
                  />
                ))}
            </section>
          )}
          <p className={css.legend}>{t('legend')}</p>
        </div>
      ) : snapshot.error === undefined ? <p className={css.empty} role="status">{t('loading')}</p> : null}
    </section>
  )
}

/** Registration-side action opening the runtime tree from the sidebar foot. */
export interface CordisTreeFooterInjected {
  readonly open: () => void
}

/** Bottom-control props: footer geometry, the open action, and localized copy. */
export type CordisTreeFooterProps =
  & PropsRuntime<'sidebar.footer.action'>
  & InjectFace<CordisTreeFooterInjected>
  & PropsLocale<'experimental-inspector'>

/** Cordis runtime trigger seated at the shared size of the sidebar's bottom controls. */
export function CordisTreeFooterButton({ wide, open, t }: CordisTreeFooterProps): ReactNode {
  return (
    <Tooltip label={t('tab')} delayMs={500}>
      <button
        type="button"
        className={`${css.footerButton} ${wide ? css.footerButtonWide : css.footerButtonRail}`}
        aria-label={t('tab')}
        onClick={() => { open() }}
      >
        <IconBranchOutline16 size={wide ? 13 : 14} />
      </button>
    </Tooltip>
  )
}
