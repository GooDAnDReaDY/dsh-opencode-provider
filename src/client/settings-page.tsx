import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import {
  clearKey,
  fetchState,
  importAuth,
  refreshModels,
  refreshState,
  saveConfig,
  saveKey,
  testConnection,
  type HostState,
  type TestResult,
  type TransportId,
  type ModelRow,
} from './api.ts'
import { UsageBars } from './usage-bars.tsx'
import { draftOf, patchOf, safeSame, type Draft } from './settings-draft.ts'
import { Field, accountMark, limitsCell, usageChip } from './settings-widgets.tsx'
import { PluginUpdateCard } from './update-card.tsx'
import { describeLimitsFull, formatRequests } from '../subscription-limits.ts'

export function OpenCodeSettingsPage(props: { t: (key: string) => string; close?: () => void }): ReactNode {
  const { t } = props
  const [state, setState] = useState<HostState | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyDrafts, setKeyDrafts] = useState<Record<number, string>>({})
  const [search, setSearch] = useState('')
  const [testModel, setTestModel] = useState('deepseek-v4.1-flash')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const next = await fetchState()
      setState(next)
      setDraft((current) => current ?? draftOf(next))
      setTestModel((current) => next.models.some((model) => model.id === current)
        ? current
        : next.models[0]?.id ?? current)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const update = (next: Partial<Draft>): void => {
    setDraft((current) => current === null ? current : { ...current, ...next })
    setNotice(null)
  }

  const save = async (): Promise<void> => {
    if (draft === null) return
    setSaving(true)
    setError(null)
    try {
      await saveConfig(patchOf(draft))
      setNotice(t('saved'))
      setState(null)
      setDraft(null)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const refresh = async (): Promise<void> => {
    try {
      const next = await refreshState()
      setState(next)
      setNotice(t('refreshed'))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('failed'))
    }
  }

  if (loading && state === null) return <p className="oc-hint">{t('loading')}</p>
  if (state === null || draft === null) {
    return (
      <div className="oc-page">
        <div className="oc-error">{error ?? t('failed')}</div>
        <button type="button" className="oc-button" onClick={() => { void load() }}>{t('refresh')}</button>
      </div>
    )
  }

  const dirty = !safeSame(draft, draftOf(state))
  const activeAccount = state.accounts.find((account) => account.active)
  const defaultAccount = state.accounts.find((account) => account.default)
  const models = state.models.filter((model) => {
    const query = search.trim().toLowerCase()
    return query === '' || model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query)
  })
  const freeModels = models.filter((model) => model.free)
  const goModels = models.filter((model) => !model.free && model.limits !== null)
  const zenModels = models.filter((model) => !model.free && model.limits === null)

  const toggleModel = (id: string): void => {
    const checked = draft.showAll || draft.visibleModels.includes(id)
    if (checked) {
      const next = (draft.showAll ? state.models.map((model) => model.id) : draft.visibleModels)
        .filter((modelId) => modelId !== id)
      if (next.length === 0) {
        update({ showAll: true, visibleModels: state.models.map((model) => model.id) })
        return
      }
      update({ showAll: false, visibleModels: next })
    } else {
      update({ showAll: false, visibleModels: [...draft.visibleModels, id] })
    }
  }

  const renderModel = (model: ModelRow): ReactNode => {
    const checked = draft.showAll || draft.visibleModels.includes(model.id)
    const hasPrice = model.cost.input > 0 || model.cost.output > 0
    const zen = !model.free && model.limits === null
    return (
      <div className="oc-model" key={model.id}>
        <input type="checkbox" checked={checked} onChange={() => toggleModel(model.id)} />
        <span className="oc-model-name" title={model.name + ' · ' + model.description}>
          {model.name}
          {model.free ? <span className="oc-badge" title={t('legendFree')}> {t('free')}</span> : null}
          {!model.free && hasPrice
            ? <span className="oc-badge" title={t('legendPrice')}> {'$'}{model.cost.input}/{'$'}{model.cost.output}</span>
            : null}
          {!model.free && !hasPrice
            ? <span className="oc-badge" title={t('legendUnknownPrice')}>{t('priceUnknown')}</span>
            : null}
          {model.limits === null
            ? null
            : (
              <span className="oc-badge" title={describeLimitsFull(model.limits)}>
                Go {formatRequests(model.limits.go.fiveHour)}/5h
              </span>
            )}
          {zen ? <span className="oc-badge" title={t('legendZen')}>{t('zenBadge')}</span> : null}
          {model.input.includes('image') ? <span className="oc-badge" title={t('legendImage')}> {t('vision')}</span> : null}
        </span>
        <select
          className="oc-select"
          value={draft.modelTransports[model.id] ?? ''}
          onChange={(event) => {
            const value = event.target.value as TransportId | ''
            const modelTransports = { ...draft.modelTransports }
            if (value === '') delete modelTransports[model.id]
            else modelTransports[model.id] = value
            update({ modelTransports })
          }}
        >
          <option value="">{t('transportAuto')} ({model.transport})</option>
          <option value="openai-chat">openai-chat</option>
          <option value="openai-responses">openai-responses</option>
          <option value="anthropic">anthropic</option>
          <option value="google">google</option>
        </select>
      </div>
    )
  }

  const renderSection = (title: string, hint: string, rows: ModelRow[]): ReactNode => {
    if (rows.length === 0) return null
    return (
      <div className="oc-model-section" key={title}>
        <div className="oc-model-section-head">
          <span>{title}</span>
          <span className="oc-badge">{rows.length}</span>
        </div>
        <p className="oc-hint">{hint}</p>
        {rows.map(renderModel)}
      </div>
    )
  }

  return (
    <div className="oc-page">
      <div className="oc-head">
        <h2 className="oc-title">{t('title')}</h2>
        <p className="oc-hint">{t('intro')}</p>
      </div>

      {error === null ? null : <div className="oc-error">{error}</div>}
      {notice === null ? null : <div className="oc-notice">{notice}</div>}

      <PluginUpdateCard t={t} />

      <section className="oc-card">
        <h3 className="oc-card-title">
          {t('key')}
          <span className={`oc-badge ${state.key.configured ? 'oc-badge-ok' : 'oc-badge-warn'}`}>
            {state.key.configured ? t('keyConfigured') : t('keyMissing')}
          </span>
          {state.key.source === undefined ? null : <span className="oc-badge">{state.key.source}</span>}
          {(() => {
            const mark = accountMark(state.accounts.find((account) => account.default), t)
            return mark === undefined ? null : <span className="oc-badge oc-badge-bad">{mark}</span>
          })()}
        </h3>
        <p className="oc-hint">{t('keyHint')}</p>
        {(() => {
          const windows = defaultAccount?.usage?.report?.windows
          if (windows === undefined) return null
          return (
            <div className="oc-row">
              {usageChip(t('fiveHour'), windows.fiveHour)}
              {usageChip(t('weekly'), windows.weekly)}
              {usageChip(t('monthly'), windows.monthly)}
            </div>
          )
        })()}
        {(() => {
          const usageError = defaultAccount?.usage?.error
          return usageError === undefined
            ? null
            : <p className="oc-hint">{t('usageError')}: {usageError}</p>
        })()}
        <div className="oc-row">
          <input
            className="oc-input"
            style={{ flex: '1 1 260px' }}
            type="password"
            autoComplete="off"
            placeholder={t('pasteKey')}
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
          />
          <button
            type="button"
            className="oc-button oc-button-primary"
            disabled={keyDraft.trim() === ''}
            onClick={() => {
              const ref = draft.apiKeyEnv.trim() === '' ? state.config.apiKeyEnv : draft.apiKeyEnv.trim()
              void saveKey(ref, keyDraft.trim())
                .then(() => { setKeyDraft(''); setNotice(t('saved')); return load() })
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t('failed')))
            }}
          >
            {t('saveKey')}
          </button>
          <button
            type="button"
            className="oc-button oc-button-danger"
            onClick={() => {
              const ref = draft.apiKeyEnv.trim() === '' ? state.config.apiKeyEnv : draft.apiKeyEnv.trim()
              void clearKey(ref)
                .then(() => { setNotice(t('saved')); return load() })
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t('failed')))
            }}
          >
            {t('clearKey')}
          </button>
          <button
            type="button"
            className="oc-button"
            onClick={() => {
              const entry = draft.openCodeAuthEntry.trim() === '' ? state.config.openCodeAuthEntry : draft.openCodeAuthEntry.trim()
              void importAuth(entry)
                .then(() => { setNotice(t('imported')); return load() })
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t('failed')))
            }}
          >
            {t('importAuth')}
          </button>
        </div>
        <div className="oc-row">
          <select
            className="oc-select"
            value={testModel}
            onChange={(event) => setTestModel(event.target.value)}
          >
            {state.models.map((model) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="oc-button"
            disabled={testing || testModel === ''}
            onClick={() => {
              setTesting(true)
              setTestResult(null)
              void testConnection(testModel)
                .then(setTestResult)
                .catch((caught: unknown) => setTestResult({
                  ok: false,
                  model: testModel,
                  provider: 'opencode-go',
                  latencyMs: 0,
                  error: caught instanceof Error ? caught.message : t('failed'),
                }))
                .finally(() => setTesting(false))
            }}
          >
            {testing ? t('testing') : t('testConnection')}
          </button>
          {testResult === null
            ? null
            : testResult.ok
              ? (
                <span className="oc-notice">
                  {t('testOk').replace('{ms}', String(testResult.latencyMs))}
                  {testResult.text === undefined || testResult.text === '' ? '' : ` · ${testResult.text.slice(0, 60)}`}
                </span>
              )
              : <span className="oc-error">{t('testFailed')}: {testResult.error}</span>}
        </div>
      </section>

      <section className="oc-card">
        <h3 className="oc-card-title">
          {t('quota')}
          <span className="oc-badge">{activeAccount?.label ?? t('noActiveAccount')}</span>
          <button type="button" className="oc-button" onClick={() => { void refresh() }}>{t('refresh')}</button>
        </h3>
        <UsageBars usage={state.usage} t={t} />
        {(() => {
          const windows = state.usage?.report?.windows
          const worst = Math.max(
            windows?.fiveHour?.percentUsed ?? 0,
            windows?.weekly?.percentUsed ?? 0,
            windows?.monthly?.percentUsed ?? 0,
          )
          if (worst >= 95) return <div className="oc-error">{t('quotaExhausted')}</div>
          if (worst >= 80) return <div className="oc-notice">{t('quotaWarning')}</div>
          return null
        })()}
      </section>

      <section className="oc-card">
        <h3 className="oc-card-title">{t('accounts')} <span className="oc-badge">{draft.accounts.length} {t('accountCount')}</span></h3>
        <p className="oc-hint">{t('accountsHint')}</p>
        {draft.accounts.map((account, index) => {
          const known = state.accounts.find((row) =>
            (account.apiKeyEnv !== '' && row.ref === account.apiKeyEnv)
            || (account.label !== '' && row.label === account.label))
          const configured = known?.configured === true
          const draftKey = keyDrafts[index] ?? ''
          return (
            <div className="oc-account-block" key={index}>
              <div className="oc-account">
                <input
                  className="oc-input"
                  placeholder={t('accountLabel')}
                  value={account.label}
                  onChange={(event) => {
                    const accounts = draft.accounts.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry)
                    update({ accounts })
                  }}
                />
                <input
                  className="oc-input"
                  placeholder={t('accountRef')}
                  value={account.apiKeyEnv}
                  onChange={(event) => {
                    const accounts = draft.accounts.map((entry, i) => i === index ? { ...entry, apiKeyEnv: event.target.value } : entry)
                    update({ accounts })
                  }}
                />
                <span className={`oc-badge ${configured ? 'oc-badge-ok' : 'oc-badge-warn'}`}>
                  {configured ? t('keyConfigured') : t('keyMissing')}
                </span>
                {known === undefined || known.mark === ''
                  ? null
                  : <span className="oc-badge oc-badge-bad">{accountMark(known, t)}</span>}
              </div>
              {known?.usage?.report === undefined ? null : (
                <div className="oc-row">
                  {usageChip(t('fiveHour'), known.usage.report.windows.fiveHour)}
                  {usageChip(t('weekly'), known.usage.report.windows.weekly)}
                  {usageChip(t('monthly'), known.usage.report.windows.monthly)}
                </div>
              )}
              {known?.usage?.error === undefined
                ? null
                : <p className="oc-hint">{t('usageError')}: {known.usage.error}</p>}
              <div className="oc-row">
                <input
                  className="oc-input"
                  style={{ flex: '1 1 200px' }}
                  type="password"
                  autoComplete="off"
                  placeholder={t('pasteKey')}
                  value={draftKey}
                  onChange={(event) => setKeyDrafts((current) => ({ ...current, [index]: event.target.value }))}
                />
                <button
                  type="button"
                  className="oc-button oc-button-primary"
                  disabled={draftKey.trim() === '' || account.apiKeyEnv.trim() === ''}
                  onClick={() => {
                    const ref = account.apiKeyEnv.trim()
                    void saveKey(ref, draftKey.trim())
                      .then(() => {
                        setKeyDrafts((current) => ({ ...current, [index]: '' }))
                        setNotice(t('saved'))
                        return load()
                      })
                      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t('failed')))
                  }}
                >
                  {t('saveKey')}
                </button>
                <button
                  type="button"
                  className="oc-button"
                  onClick={() => update({ activeAccount: account.label !== '' ? account.label : account.apiKeyEnv })}
                >
                  {t('pinAccount')}
                </button>
                <button
                  type="button"
                  className="oc-button oc-button-danger"
                  onClick={() => update({ accounts: draft.accounts.filter((_, i) => i !== index) })}
                >
                  {t('removeAccount')}
                </button>
              </div>
            </div>
          )
        })}
        <div className="oc-row">
          <button
            type="button"
            className="oc-button"
            onClick={() => update({ accounts: [...draft.accounts, { label: '', apiKeyEnv: '' }] })}
          >
            {t('addAccount')}
          </button>
          <span className="oc-badge">
            {t('activeAccount')}: {draft.activeAccount === '' ? t('auto') : draft.activeAccount}
          </span>
          {draft.activeAccount === '' ? null : (
            <button type="button" className="oc-button" onClick={() => update({ activeAccount: '' })}>
              {t('auto')}
            </button>
          )}
        </div>
      </section>

      <section className="oc-card">
        <h3 className="oc-card-title">{t('modelAccountRules')}</h3>
        <p className="oc-hint">{t('modelAccountRulesHint')}</p>
        {draft.modelAccountRules.map((rule, index) => (
          <div className="oc-row" key={index}>
            <input
              className="oc-input"
              placeholder={t('rulePattern')}
              value={rule.pattern}
              onChange={(event) => {
                const modelAccountRules = draft.modelAccountRules.map((entry, i) =>
                  i === index ? { ...entry, pattern: event.target.value } : entry)
                update({ modelAccountRules })
              }}
            />
            <input
              className="oc-input"
              list="oc-account-labels"
              placeholder={t('ruleAccount')}
              value={rule.account}
              onChange={(event) => {
                const modelAccountRules = draft.modelAccountRules.map((entry, i) =>
                  i === index ? { ...entry, account: event.target.value } : entry)
                update({ modelAccountRules })
              }}
            />
            <button
              type="button"
              className="oc-button oc-button-danger"
              onClick={() => update({
                modelAccountRules: draft.modelAccountRules.filter((_, i) => i !== index),
              })}
            >
              {t('removeRule')}
            </button>
          </div>
        ))}
        <datalist id="oc-account-labels">
          <option value="default" />
          {draft.accounts.map((account, index) => account.label.trim() === ''
            ? null
            : <option key={`label-${index}`} value={account.label.trim()} />)}
        </datalist>
        <button
          type="button"
          className="oc-button"
          onClick={() => update({
            modelAccountRules: [...draft.modelAccountRules, { pattern: '', account: '' }],
          })}
        >
          {t('addRule')}
        </button>
      </section>

      <section className="oc-card">
        <h3 className="oc-card-title">{t('routing')}</h3>
        <p className="oc-hint">{t('routingHint')}</p>
        <label className="oc-row">
          <input
            type="checkbox"
            checked={draft.stickySession}
            onChange={(event) => update({ stickySession: event.target.checked })}
          />
          <span>{t('stickySession')}</span>
        </label>
        <p className="oc-hint">{t('stickySessionHint')}</p>
        <label className="oc-field">
          <span className="oc-label">{t('quotaFallbackModel')}</span>
          <select
            className="oc-select"
            value={draft.quotaFallbackModel}
            onChange={(event) => update({ quotaFallbackModel: event.target.value })}
          >
            <option value="">{t('off')}</option>
            {state.models.filter((model) => model.free).map((model) => (
              <option key={model.id} value={model.id}>{model.name} ({model.id})</option>
            ))}
          </select>
          <span className="oc-hint">{t('quotaFallbackModelHint')}</span>
        </label>
      </section>

      <section className="oc-card">
        <h3 className="oc-card-title">
          {t('models')}
          <span className="oc-badge">{state.models.length} {t('modelCount')}</span>
          <button type="button" className="oc-button" onClick={() => update({ showAll: true, visibleModels: state.models.map((model) => model.id) })}>
            {t('showAll')}
          </button>
          <button
            type="button"
            className="oc-button"
            onClick={() => {
              void refreshModels()
                .then((next) => { setState(next); setNotice(t('refreshed')) })
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t('failed')))
            }}
          >
            {t('refresh')}
          </button>
        </h3>
        <p className="oc-hint">{t('modelsHint')}</p>
        <label className="oc-row">
          <input
            type="checkbox"
            checked={draft.filterModelsByPlan}
            onChange={(event) => update({ filterModelsByPlan: event.target.checked })}
          />
          <span>{t('filterModelsByPlan')}</span>
        </label>
        <p className="oc-hint">{t('filterModelsByPlanHint')}</p>
        <p className="oc-hint">{t('limitsHint')}</p>
        <div className="oc-model-legend">
          <span><span className="oc-badge">{t('free')}</span> {t('legendFree')}</span>
          <span><span className="oc-badge">$in/$out</span> {t('legendPrice')}</span>
          <span><span className="oc-badge">Go N/5h</span> {t('legendGo')}</span>
          <span><span className="oc-badge">{t('zenBadge')}</span> {t('legendZen')}</span>
          <span><span className="oc-badge">{t('vision')}</span> {t('legendImage')}</span>
        </div>
        <input className="oc-input" placeholder={t('modelSearch')} value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="oc-models">
          {models.length === 0
            ? <p className="oc-hint">{t('modelsEmpty')}</p>
            : (
              <>
                {renderSection(t('sectionFree'), t('sectionFreeHint'), freeModels)}
                {renderSection(t('sectionGo'), t('sectionGoHint'), goModels)}
                {renderSection(t('sectionZen'), t('sectionZenHint'), zenModels)}
              </>
            )}
        </div>
        <details className="oc-limits">
          <summary>{t('limitsTitle')}</summary>
          <p className="oc-hint">{t('limitsWindow')}</p>
          <table className="oc-table">
            <thead>
              <tr>
                <th>{t('model')}</th>
                <th>Go</th>
                <th>Go Plus</th>
              </tr>
            </thead>
            <tbody>
              {state.models.filter((model) => model.limits !== null).map((model) => (
                <tr key={model.id}>
                  <td>{model.name}</td>
                  <td>{limitsCell(model.limits!.go)}</td>
                  <td>{limitsCell(model.limits!.goPlus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section className="oc-card">
        <h3 className="oc-card-title">{t('advanced')}</h3>
        <div className="oc-grid">
          <Field label={t('apiKeyEnv')} hint={t('apiKeyEnvHint')} value={draft.apiKeyEnv} onChange={(value) => update({ apiKeyEnv: value })} />
          <Field label={t('openCodeAuthEntry')} hint={t('openCodeAuthEntryHint')} value={draft.openCodeAuthEntry} onChange={(value) => update({ openCodeAuthEntry: value })} list="oc-auth-entries" />
          <datalist id="oc-auth-entries">
            {state.auth.entries.map((entry) => <option key={entry} value={entry} />)}
          </datalist>
          <Field label={t('apiBase')} value={draft.apiBase} onChange={(value) => update({ apiBase: value })} />
          <Field label={t('goApiBase')} value={draft.goApiBase} onChange={(value) => update({ goApiBase: value })} />
          <Field label={t('goZenBase')} value={draft.goZenBase} onChange={(value) => update({ goZenBase: value })} />
          <Field label={t('usageUrl')} value={draft.usageUrl} onChange={(value) => update({ usageUrl: value })} />
          <Field label={t('requestTimeoutMs')} type="number" value={draft.requestTimeoutMs} onChange={(value) => update({ requestTimeoutMs: value })} />
          <Field label={t('streamIdleTimeoutMs')} type="number" value={draft.streamIdleTimeoutMs} onChange={(value) => update({ streamIdleTimeoutMs: value })} />
          <Field label={t('maxOutputTokens')} type="number" value={draft.maxOutputTokens} onChange={(value) => update({ maxOutputTokens: value })} />
          <Field label={t('contextWindow')} type="number" value={draft.contextWindow} onChange={(value) => update({ contextWindow: value })} />
        </div>
        <label className="oc-row">
          <input
            type="checkbox"
            checked={draft.showSidebarQuota}
            onChange={(event) => update({ showSidebarQuota: event.target.checked })}
          />
          <span>{t('showSidebarQuota')}</span>
        </label>
      </section>

      <div className="oc-row">
        <button type="button" className="oc-button oc-button-primary" disabled={!dirty || saving} onClick={() => { void save() }}>
          {saving ? t('saving') : t('save')}
        </button>
        {dirty ? <span className="oc-badge oc-badge-warn">{t('unsaved')}</span> : null}
        <button type="button" className="oc-button" onClick={() => {
          if (props.close !== undefined) props.close()
          else { setDraft(draftOf(state)); setNotice(null); setError(null) }
        }}>
          {t('close')}
        </button>
      </div>
    </div>
  )
}
