import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { fetchAnalytics, fetchState, refreshState, type AccountRow, type AnalyticsReport, type HostState, type UsageWindow } from './api.ts'
import { RequestHeatmapView } from './heatmap.tsx'
import { UsageAnalyticsView } from './usage-analytics.tsx'
import { UsageBars } from './usage-bars.tsx'

const PANEL_EVENT = 'dsh-opencode-panel-state'

function broadcastPanel(open: boolean): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<boolean>(PANEL_EVENT, { detail: open }))
}

function usePanelOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onChange = (event: Event): void => {
      if (event instanceof CustomEvent) setOpen(event.detail === true)
    }
    window.addEventListener(PANEL_EVENT, onChange)
    return () => window.removeEventListener(PANEL_EVENT, onChange)
  }, [])
  return open
}

function useHostState(intervalMs: number): HostState | null {
  const [state, setState] = useState<HostState | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      void fetchState().then((next) => { if (!cancelled) setState(next) }).catch(() => {})
    }
    load()
    const timer = setInterval(load, intervalMs)
    return () => { cancelled = true; clearInterval(timer) }
  }, [intervalMs])
  return state
}

function percent(window: UsageWindow | undefined): number {
  return window === undefined ? 0 : Math.max(0, Math.min(100, window.percentUsed))
}

function remaining(window: UsageWindow | undefined): number {
  return Math.max(0, 100 - Math.round(percent(window)))
}

function resetIn(iso: string | undefined): string {
  if (iso === undefined) return ''
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at)) return ''
  const delta = at - Date.now()
  if (delta <= 0) return 'now'
  if (delta >= 86_400_000) return `${Math.round(delta / 86_400_000)}d`
  if (delta >= 3_600_000) return `${Math.round(delta / 3_600_000)}h`
  return `${Math.max(1, Math.round(delta / 60_000))}m`
}

function usagePercent(window: UsageWindow | undefined): string {
  return window === undefined ? '—' : `${Math.round(window.percentUsed)}%`
}

function accountStatus(account: AccountRow, t: (key: string) => string): string | undefined {
  if (account.mark !== '') {
    const label = account.mark === 'invalid-credential'
      ? t('markInvalid')
      : account.mark === 'quota'
        ? t('markQuota')
        : account.mark === 'rate-limit'
          ? t('markRateLimit')
          : t('markTransport')
    return account.coolingUntil > 0
      ? `${label} · ${resetIn(new Date(account.coolingUntil).toISOString())}`
      : label
  }
  const windows = account.usage?.report?.windows
  return [windows?.fiveHour, windows?.weekly, windows?.monthly]
    .map((window) => window?.status)
    .find((value) => value !== undefined && value !== 'ok')
}

function routingLabel(reason: string, t: (key: string) => string): string {
  if (reason === 'rule') return t('routingRule')
  if (reason === 'sticky') return t('routingSticky')
  if (reason === 'pinned') return t('routingPinned')
  if (reason === 'rotation') return t('routingRotation')
  if (reason === 'quota-fallback') return t('routingFallback')
  return t('routingDefault')
}

function fillClass(value: number): string {
  if (value >= 90) return 'oc-footFill oc-footFillBad'
  if (value >= 75) return 'oc-footFill oc-footFillWarn'
  return 'oc-footFill'
}

function MiniRing(props: { percent: number; warn: boolean; size?: number }): ReactNode {
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const value = Math.max(0, Math.min(100, props.percent))
  const offset = circumference - (value / 100) * circumference
  const size = props.size ?? 16

  return (
    <svg className="oc-ring" width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r={radius}
        stroke="var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.25))"
        strokeWidth="2.5"
      />
      <circle
        cx="10"
        cy="10"
        r={radius}
        stroke={props.warn
          ? 'var(--dsw-alias-state-error-primary, #e07a7a)'
          : 'var(--dsw-alias-brand-primary, #4fbf86)'}
        strokeWidth="2.5"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 10 10)"
        style={{ transition: 'stroke-dashoffset 0.3s ease' }}
      />
    </svg>
  )
}

export function QuotaCard(props: {
  t: (key: string) => string
  open?: () => void
  wide?: boolean
}): ReactNode {
  const { t } = props
  const state = useHostState(60_000)
  const expanded = usePanelOpen()
  if (state === null || state.config.showSidebarQuota !== true) return null

  const windows = state.usage?.report?.windows
  const active = state.accounts.find((account) => account.active)
  const accountLabel = active?.label
  const rows = [
    { key: 'fiveHour', label: t('fiveHourWindow'), window: windows?.fiveHour },
    { key: 'weekly', label: t('weeklyWindow'), window: windows?.weekly },
    { key: 'monthly', label: t('monthlyWindow'), window: windows?.monthly },
  ].filter((row): row is { key: string; label: string; window: UsageWindow } => row.window !== undefined)
  const worst = rows.reduce((value, row) => Math.max(value, percent(row.window)), 0)
  const warn = worst >= 90
  const caution = worst >= 75
  const name = accountLabel === undefined || accountLabel === 'default'
    ? t('quotaCardName')
    : `${t('quotaCardName')} · ${accountLabel}`
  const detail = rows.map((row) => {
    const reset = resetIn(row.window.resetsAt)
    const status = row.window.status === undefined || row.window.status === 'ok'
      ? ''
      : ` · ${row.window.status}`
    return `${row.label}: ${remaining(row.window)}% ${t('remaining')}${reset === '' ? '' : ` · ${reset}`}${status}`
  }).join(' · ')
  const title = `${name} — ${detail === '' ? (state.usage?.error ?? t('noUsage')) : detail}`
  const open = (): void => {
    broadcastPanel(true)
    props.open?.()
  }

  if (props.wide === false) {
    return (
      <button
        type="button"
        className="oc-railButton"
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        onClick={open}
      >
        <MiniRing percent={worst} warn={warn} size={20} />
      </button>
    )
  }

  return (
    <button
      type="button"
      className="oc-foot"
      title={title}
      aria-label={title}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={open}
    >
      <span className="oc-footTop">
        <MiniRing percent={worst} warn={warn} size={16} />
        <span className="oc-footName">{name}</span>
        <span className={`oc-footPct${warn ? ' oc-footPctBad' : caution ? ' oc-footPctWarn' : ''}`}>
          {rows.length === 0 ? '—' : `${Math.round(worst)}%`}
        </span>
      </span>
      {rows.length === 0
        ? <span className="oc-footMessage">{state.usage?.error ?? t('noUsage')}</span>
        : rows.map((row) => {
          const used = percent(row.window)
          const reset = resetIn(row.window.resetsAt)
          const status = row.window.status === undefined || row.window.status === 'ok'
            ? ''
            : row.window.status
          return (
            <span className="oc-footRow" key={row.key}>
              <span className="oc-footHead">
                <span className="oc-footLabel">{row.label}</span>
                <span className="oc-footAmount">
                  {remaining(row.window)}% {t('remaining')}
                  {reset === '' ? '' : ` · ${reset}`}
                  {status === '' ? '' : ` · ${status}`}
                </span>
              </span>
              <span className="oc-footBar">
                <span
                  className={fillClass(used)}
                  style={{ width: `${used === 0 ? 0 : Math.max(2, used)}%` }}
                />
              </span>
            </span>
          )
        })}
    </button>
  )
}

export function QuotaPanel(props: { t: (key: string) => string; close?: () => void }): ReactNode {
  const { t } = props
  const [state, setState] = useState<HostState | null>(null)
  const [stateError, setStateError] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<AnalyticsReport | null>(null)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const analyticsSeq = useRef(0)

  const load = (): void => {
    void fetchState()
      .then((next) => { setState(next); setStateError(null) })
      .catch((caught: unknown) => {
        setStateError(caught instanceof Error ? caught.message : 'state failed')
      })
  }

  const loadAnalytics = (windowDays: number): void => {
    const seq = analyticsSeq.current + 1
    analyticsSeq.current = seq
    setAnalyticsError(null)
    void fetchAnalytics(windowDays)
      .then((next) => {
        if (seq !== analyticsSeq.current) return
        setAnalytics(next)
        setAnalyticsError(null)
      })
      .catch((caught: unknown) => {
        if (seq !== analyticsSeq.current) return
        setAnalytics(null)
        setAnalyticsError(caught instanceof Error ? caught.message : 'analytics failed')
      })
  }

  useEffect(() => {
    load()
    loadAnalytics(days)
    const timer = setInterval(load, 60_000)
    return () => {
      clearInterval(timer)
      analyticsSeq.current += 1
    }
  }, [days])

  useEffect(() => () => broadcastPanel(false), [])

  const activeAccount = state?.accounts.find((account) => account.active)

  const refresh = (): void => {
    setBusy(true)
    void refreshState()
      .then((next) => { setState(next); setStateError(null) })
      .catch((caught: unknown) => {
        setStateError(caught instanceof Error ? caught.message : 'state failed')
      })
      .finally(() => setBusy(false))
    loadAnalytics(days)
  }

  return (
    <div className="oc-panel">
      <div className="oc-panel-head">
        <h2 className="oc-title">{t('quotaTitle')}</h2>
        <div className="oc-row">
          <select
            className="oc-select"
            value={String(days)}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
          <button type="button" className="oc-button" disabled={busy} onClick={refresh}>
            {busy ? t('loading') : t('refresh')}
          </button>
          <button type="button" className="oc-button" onClick={() => { broadcastPanel(false); props.close?.() }}>
            {t('close')}
          </button>
        </div>
      </div>

      {stateError === null ? null : (
        <p className="oc-hint">{t('failed')}: {stateError}</p>
      )}

      <section className="oc-card">
        <div className="oc-row">
          <span className="oc-badge">{t('activeAccountNow')}: {activeAccount?.label ?? t('noActiveAccount')}</span>
        </div>
        <UsageBars usage={state?.usage ?? null} t={t} />
      </section>

      {state === null || state.accounts.length < 2 ? null : (
        <section className="oc-card">
          <h3 className="oc-card-title">{t('accounts')}</h3>
          <table className="oc-table">
            <thead>
              <tr>
                <th>{t('accountLabel')}</th>
                <th>{t('fiveHour')}</th>
                <th>{t('weekly')}</th>
                <th>{t('monthly')}</th>
              </tr>
            </thead>
            <tbody>
              {state.accounts.map((account) => {
                const accountWindows = account.usage?.report?.windows
                const status = accountStatus(account, t)
                return (
                  <tr key={account.label}>
                    <td>
                      {account.label}{account.active ? ` · ${t('active')}` : ''}
                      {status === undefined
                        ? null
                        : (
                          <span
                            className="oc-badge oc-badge-bad"
                            style={{ marginLeft: 6 }}
                            title={account.coolingUntil > 0
                              ? new Date(account.coolingUntil).toLocaleString()
                              : undefined}
                          >
                            {status}
                          </span>
                        )}
                    </td>
                    <td>{usagePercent(accountWindows?.fiveHour)}</td>
                    <td>{usagePercent(accountWindows?.weekly)}</td>
                    <td>{usagePercent(accountWindows?.monthly)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="oc-hint">{t('accountsHint')}</p>
        </section>
      )}

      <section className="oc-card">
        <h3 className="oc-card-title">{t('routing')}</h3>
        {(state?.routing ?? []).length === 0
          ? <p className="oc-hint">{t('routingEmpty')}</p>
          : (
            <div className="oc-table-scroll">
              <table className="oc-table">
                <thead>
                  <tr>
                    <th>{t('date')}</th>
                    <th>{t('accountLabel')}</th>
                    <th>{t('model')}</th>
                    <th>{t('routing')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(state?.routing ?? []).slice(0, 8).map((row) => (
                    <tr key={`${row.at}-${row.account}-${row.model}-${row.reason}`}>
                      <td>{new Date(row.at).toLocaleTimeString()}</td>
                      <td>{row.account}</td>
                      <td>{row.model}</td>
                      <td>
                        {routingLabel(row.reason, t)}
                        {row.fallback ? ` · ${t('routingFallback')}` : ''}
                        {row.ok ? '' : ` · ${t('routingFailed')}${row.error === undefined ? '' : ` (${row.error})`}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <p className="oc-hint">{t('routingHint')}</p>
      </section>

      <section className="oc-card">
        <div className="oc-row">
          <span className="oc-badge">{state?.accounts.length ?? 0} {t('accountCount')}</span>
          <span className="oc-badge">{state?.models.length ?? 0} {t('modelCount')}</span>
          <span className={`oc-badge ${state?.key.configured === true ? 'oc-badge-ok' : 'oc-badge-warn'}`}>
            {state?.key.configured === true ? t('configured') : t('notConfigured')}
          </span>
        </div>
        <p className="oc-hint">{t('intro')}</p>
      </section>

      <section className="oc-card">
        {analyticsError !== null
          ? (
            <>
              <h3 className="oc-card-title">{t('usageAnalytics')}</h3>
              <p className="oc-hint">{t('failed')}: {analyticsError}</p>
              <button type="button" className="oc-button" onClick={() => loadAnalytics(days)}>
                {t('refresh')}
              </button>
            </>
          )
          : analytics === null
            ? (
              <>
                <h3 className="oc-card-title">{t('usageAnalytics')}</h3>
                <p className="oc-hint">{t('loading')}</p>
              </>
            )
            : <UsageAnalyticsView analytics={analytics} t={t} days={days} onDays={setDays} />}
      </section>

      <section className="oc-card">
        <h3 className="oc-card-title">{t('requestHeatmap')}</h3>
        {analyticsError !== null
          ? <p className="oc-hint">{t('failed')}: {analyticsError}</p>
          : analytics === null
            ? <p className="oc-hint">{t('loading')}</p>
            : <RequestHeatmapView heatmap={analytics.heatmap} t={t} />}
      </section>
    </div>
  )
}
