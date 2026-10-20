/**
 * The model-provider window: the route picker, the route facts row (format,
 * endpoint, key — the same trio and writes as the Models page), and one
 * fixed-column table per route whose write-ins validate live and commit
 * through `remote.settings.mutate`; the view session's dotted row commits
 * its tune through the shared selection projection, exactly as the
 * composer seat does, while its capacity cells stay settings writes.
 * Rates render read-only from the deployment's pricing table. Every dropdown
 * here is the Menu primitive in portal mode: this panel scrolls, so an
 * in-place list would be cropped by the card that opened it.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { formatCapacity, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { draftErrors } from './rules.ts'
import type { ProviderModelRow, ProviderWindowStore } from './store.ts'
import { derivedRefOf } from './store.ts'
import type { ProviderKey } from './locales.ts'
import css from './Provider.module.css'

/** Injected dependencies of {@link ProviderWindow}. */
export interface ProviderWindowInjected {
  /** The window store (loaded on open, refreshed on pushed invalidations). */
  controller: ProviderWindowStore
  hooks: {
    /** Window snapshot bound by the UI renderer as useSyncExternalStore. */
    provider: ProviderWindowStore['store']
  }
  /** Bound dictionary reader for this window's namespace. */
  t: (key: ProviderKey, values?: Record<string, string>) => string
}

/** Props delivered by the slot outlet plus the shell's close affordance. */
export type ProviderWindowProps = Partial<ProviderWindowInjected> & {
  onClose: () => void
}

/**
 * The portaled provider window.
 * @param props - inject face and close callback.
 */
export function ProviderWindow({ controller, hooks, t, onClose }: ProviderWindowProps) {
  const providerStore = hooks?.provider
  const state = providerStore === undefined
    ? undefined
    : useSyncExternalStore(
      fn => providerStore.subscribe(fn),
      () => providerStore.getSnapshot(),
    )
  const [drafts, setDrafts] = useState<Record<string, { temp: string; ctx: string; max: string }>>({})
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [keyText, setKeyText] = useState('')
  useEffect(() => {
    void controller?.load()
  }, [controller])
  const rates = useMemo(() => state?.pricing?.models ?? {}, [state?.pricing])
  if (state === undefined || controller === undefined || t === undefined) return null
  const route = state.routes.find(candidate => candidate.provider === state.current)
  const draftsFor = (id: string, row: {
    tunes?: { temperature?: number }
    contextWindow?: number
    maxTokens?: number
  }): { temp: string; ctx: string; max: string } => drafts[id] ?? {
    temp: id === state.session?.model && state.session.temperature !== undefined
      ? String(state.session.temperature)
      : row.tunes?.temperature !== undefined ? String(row.tunes.temperature) : '',
    ctx: row.contextWindow !== undefined ? formatCapacity(row.contextWindow) : '',
    max: row.maxTokens !== undefined ? formatCapacity(row.maxTokens) : '',
  }
  /** Commit one row's temp draft: the dotted row rides the session projection. */
  const commitTemp = (
    isSession: boolean,
    next: { temp: string; ctx: string; max: string },
    effort: string | undefined,
    row: ProviderModelRow,
  ): void => {
    const errors = draftErrors(next, state.profile?.maxContextWindow)
    if (isSession) {
      if (errors.temp === undefined && next.temp.trim().length > 0) {
        void controller.selectSession({ temperature: Number(next.temp) })
      }
      return
    }
    void controller.commitModel(row, next, effort, errors)
  }
  return createPortal(
    <div className={css.overlay} role="presentation">
      <div className={css.mask} aria-hidden="true" onClick={onClose} />
      <div className={css.panel} role="dialog" aria-modal="true" aria-label={t('window.title')}>
        <div className={css.headTitle}>
          <span>{t('window.title')}</span>
          <button type="button" className={css.close} aria-label={t('window.close')} onClick={onClose}>×</button>
        </div>
        <div className={css.pickRow}>
          <Menu
            open={openMenu === 'providers'}
            portal
            autoFocus
            anchor={(
              <button
                type="button"
                className={css.select}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'providers'}
                aria-label={t('provider.aria')}
                onClick={() => { setOpenMenu(openMenu === 'providers' ? null : 'providers') }}
              >
                <span>{state.current}</span>
                <span className={css.ns}>{route?.settingsNs}</span>
              </button>
            )}
            items={state.routes.map(row => ({
              id: row.provider,
              label: (
                <span className={css.optionLabel}>
                  <span className={css.name}>{row.provider}</span>
                  <span className={css.addr}>{row.settingsNs} · {row.settingsPath.join('.') || t('provider.section')}</span>
                </span>
              ),
            }))}
            selectedId={state.current}
            onSelect={(provider) => { setOpenMenu(null); void controller.select(provider) }}
            onClose={() => { setOpenMenu(null) }}
          />
          <button
            type="button"
            className={`${css.select} ${css.fetch}`}
            onClick={() => { void controller.fetchSpecs() }}
          >
            {t('fetch.action')}
          </button>
        </div>
        <div className={css.pickRow}>
          <span className={css.lab}>{t('route.format')}</span>
          <Menu
            open={openMenu === 'format'}
            portal
            autoFocus
            anchor={(
              <button
                type="button"
                className={css.select}
                aria-haspopup="menu"
                aria-expanded={openMenu === 'format'}
                onClick={() => { setOpenMenu(openMenu === 'format' ? null : 'format') }}
              >
                {state.profile?.api ?? '—'}
              </button>
            )}
            items={state.protocols.map(protocol => ({ id: protocol, label: protocol }))}
            selectedId={state.profile?.api}
            onSelect={(protocol) => { setOpenMenu(null); void controller.commitFormat(protocol) }}
            onClose={() => { setOpenMenu(null) }}
          />
          <span className={css.lab}>{t('route.endpoint')}</span>
          <span className={`${css.wrap} ${css.wide}`}>
            <input
              className={`${css.input} ${css.url}`}
              defaultValue={state.profile?.baseURL ?? ''}
              aria-label={t('route.endpoint')}
              onBlur={(event) => { void controller.commitBaseURL(event.target.value) }}
            />
          </span>
          <span className={css.lab}>{t('route.key')}</span>
          <span className={`${css.wrap} ${css.wide}`}>
            {state.profile?.apiKeyEnv !== undefined && (
              <span className={`${css.keychip} ${state.credentials[state.profile.apiKeyEnv]?.configured === true ? css.ok : css.missing}`}>
                {t('route.keyStored', { ref: state.profile.apiKeyEnv })}
              </span>
            )}
            <input
              className={`${css.input} ${css.key}`}
              placeholder={t('route.keyPlaceholder', { ref: state.profile?.apiKeyEnv ?? derivedRefOf(state.current ?? '') })}
              value={keyText}
              onChange={(event) => { setKeyText(event.target.value) }}
              aria-label={t('route.key')}
            />
            <button
              type="button"
              className={css.save}
              onClick={() => { void controller.saveKey(keyText).then((refusal) => { if (refusal === undefined) setKeyText('') }) }}
            >
              {t('route.keySave')}
            </button>
          </span>
        </div>
        {state.failure !== null && <div className={css.failure}>{state.failure}</div>}
        {state.models.length === 0
          ? <div className={css.empty}>{t('table.empty')}</div>
          : (
            <table className={css.table}>
              <thead>
                <tr>
                  <th className={css.cModel} rowSpan={2}>{t('table.model')}</th>
                  <th className={css.cTemp}><span className={`${css.g} ${css.gSess}`}>{t('table.groupSession')}</span></th>
                  <th className={css.cEffort}><span className={`${css.g} ${css.gSess}`}>{t('table.groupTune')}</span></th>
                  <th className={css.cCtx} colSpan={2}><span className={`${css.g} ${css.gCap}`}>{t('table.groupCapacity')}</span></th>
                  <th className={css.cMoney} colSpan={4}><span className={`${css.g} ${css.gMoney}`}>{t('table.groupMoney')}</span></th>
                </tr>
                <tr>
                  <th>{t('table.temp')}</th>
                  <th>{t('table.effort')}</th>
                  <th>{t('table.ctx')}</th>
                  <th>{t('table.max')}</th>
                  <th className={css.num}>{t('table.in')}</th>
                  <th className={css.num}>{t('table.out')}</th>
                  <th className={css.num}>{t('table.read')}</th>
                  <th className={css.num}>{t('table.write')}</th>
                </tr>
              </thead>
              <tbody>
                {state.models.map((row) => {
                  const isSession = state.session?.model === row.id
                  const draft = draftsFor(row.id, row)
                  const errors = draftErrors(draft, state.profile?.maxContextWindow)
                  const modelRates = rates[row.id]
                  const effort = currentEffort(isSession, state.session?.reasoningEffort, row.tunes)
                  return (
                    <tr key={row.id}>
                      <td className={css.rowName}>
                        {isSession && <span className={css.dot} aria-hidden="true" />}
                        {row.id}
                      </td>
                      <td>
                        <span className={`${css.wrap}${errors.temp !== undefined ? ` ${css.bad}` : ''}`} title={errors.temp}>
                          <input
                            className={css.input}
                            value={draft.temp}
                            aria-label={`${t('table.temp')} ${row.id}`}
                            onChange={(event) => { setDrafts(current => ({
                              ...current,
                              [row.id]: { ...draft, temp: event.target.value },
                            })) }}
                            onBlur={(event) => {
                              commitTemp(isSession, { ...draft, temp: event.target.value }, effort, row)
                            }}
                          />
                        </span>
                      </td>
                      <td className={css.cellEffort}>
                        {row.efforts.length === 0
                          ? (
                            <span className={`${css.select} ${css.cellSelect}`}>
                              <span className={css.name}>{t('effort.none')}</span>
                            </span>
                          )
                          : (
                            <Menu
                              open={openMenu === `effort:${row.id}`}
                              portal
                              autoFocus
                              anchor={(
                                <button
                                  type="button"
                                  className={`${css.select} ${css.cellSelect}`}
                                  aria-haspopup="menu"
                                  aria-expanded={openMenu === `effort:${row.id}`}
                                  aria-label={t('effort.aria', { model: row.id })}
                                  onClick={() => { setOpenMenu(openMenu === `effort:${row.id}` ? null : `effort:${row.id}`) }}
                                >
                                  <span className={css.name}>{effort ?? t('effort.none')}</span>
                                </button>
                              )}
                              items={row.efforts.map(level => ({ id: level, label: level }))}
                              selectedId={effort}
                              onSelect={(level) => {
                                setOpenMenu(null)
                                if (isSession) void controller.selectSession({ reasoningEffort: level })
                                else void controller.commitModel(row, draft, level, errors)
                              }}
                              onClose={() => { setOpenMenu(null) }}
                            />
                          )}
                      </td>
                      <td>
                        <span className={`${css.wrap}${errors.ctx !== undefined ? ` ${css.bad}` : ''}`} title={errors.ctx}>
                          <input
                            className={css.input}
                            value={draft.ctx}
                            aria-label={`${t('table.ctx')} ${row.id}`}
                            onChange={(event) => { setDrafts(current => ({
                              ...current,
                              [row.id]: { ...draft, ctx: event.target.value },
                            })) }}
                            onBlur={(event) => {
                              const next = { ...draft, ctx: event.target.value }
                              void controller.commitModel(row, next, effort, draftErrors(next, state.profile?.maxContextWindow))
                            }}
                          />
                        </span>
                      </td>
                      <td>
                        <span className={`${css.wrap}${errors.max !== undefined ? ` ${css.bad}` : ''}`} title={errors.max}>
                          <input
                            className={css.input}
                            value={draft.max}
                            aria-label={`${t('table.max')} ${row.id}`}
                            onChange={(event) => { setDrafts(current => ({
                              ...current,
                              [row.id]: { ...draft, max: event.target.value },
                            })) }}
                            onBlur={(event) => {
                              const next = { ...draft, max: event.target.value }
                              void controller.commitModel(row, next, effort, draftErrors(next, state.profile?.maxContextWindow))
                            }}
                          />
                        </span>
                      </td>
                      {[
                        modelRates?.inputPerMillionUsd,
                        modelRates?.outputPerMillionUsd,
                        modelRates?.cacheReadPerMillionUsd,
                        modelRates?.cacheWritePerMillionUsd,
                      ].map((value, index) => (
                        <td key={index} className={`${css.num} ${css.money}`}>
                          {value === undefined ? '—' : String(value)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
      </div>
    </div>,
    document.body,
  )
}

/** The effort the dotted row or a stored tune shows for one row. */
function currentEffort(
  isSession: boolean,
  sessionEffort: string | undefined,
  tunes: { reasoningEffort?: string } | undefined,
): string | undefined {
  return isSession ? sessionEffort ?? tunes?.reasoningEffort : tunes?.reasoningEffort
}
