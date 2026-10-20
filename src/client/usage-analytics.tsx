import { useState } from 'react'
import type { ReactNode } from 'react'

import type { AnalyticsReport, DayUsageRow, ModelUsageRow, SessionUsageRow } from './api.ts'

type Tab = 'models' | 'days' | 'sessions'

function compact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

function ms(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : `${Math.round(value)} ms`
}

function Kpi(props: { label: string; value: string; title?: string | undefined }): ReactNode {
  return (
    <div className="oc-kpi" title={props.title}>
      <span className="oc-kpi-value">{props.value}</span>
      <span className="oc-kpi-label">{props.label}</span>
    </div>
  )
}

function modelRows(report: AnalyticsReport, t: (key: string) => string): ReactNode {
  if (report.models.length === 0) return <p className="oc-hint">{t('analyticsEmpty')}</p>
  return (
    <div className="oc-table-scroll">
      <table className="oc-table">
        <thead>
          <tr>
            <th>{t('model')}</th>
            <th>{t('requests')}</th>
            <th>{t('tokens')}</th>
            <th>{t('avgTtft')}</th>
          </tr>
        </thead>
        <tbody>
          {report.models.map((row: ModelUsageRow) => (
            <tr key={`${row.provider}/${row.model}`}>
              <td>{row.model}</td>
              <td>{row.steps}</td>
              <td>{compact(row.inputTokens + row.outputTokens)}</td>
              <td>{ms(row.ttftSteps > 0 ? row.ttftMs / row.ttftSteps : null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function dayRows(report: AnalyticsReport, t: (key: string) => string): ReactNode {
  if (report.days.length === 0) return <p className="oc-hint">{t('analyticsEmpty')}</p>
  return (
    <div className="oc-table-scroll">
      <table className="oc-table">
        <thead>
          <tr>
            <th>{t('date')}</th>
            <th>{t('sessions')}</th>
            <th>{t('requests')}</th>
            <th>{t('tokens')}</th>
            <th>{t('avgTtft')}</th>
          </tr>
        </thead>
        <tbody>
          {report.days.map((row: DayUsageRow) => (
            <tr key={row.date}>
              <td>{row.date}</td>
              <td>{row.sessions}</td>
              <td>{row.requests}</td>
              <td>{compact(row.tokens)}</td>
              <td>{ms(row.avgTtftMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function sessionRows(report: AnalyticsReport, t: (key: string) => string): ReactNode {
  if (report.sessions.length === 0) return <p className="oc-hint">{t('analyticsEmpty')}</p>
  return (
    <div className="oc-table-scroll">
      <table className="oc-table">
        <thead>
          <tr>
            <th>{t('session')}</th>
            <th>{t('model')}</th>
            <th>{t('requests')}</th>
            <th>{t('tokens')}</th>
            <th>{t('avgTtft')}</th>
          </tr>
        </thead>
        <tbody>
          {report.sessions.map((row: SessionUsageRow) => (
            <tr key={`${row.id}-${row.at}`}>
              <td title={row.id}>{row.id.replace(/^session-/, '').slice(0, 10) || '—'}</td>
              <td>{row.model}</td>
              <td>{row.requests}</td>
              <td>{compact(row.tokens)}</td>
              <td>{ms(row.avgTtftMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function UsageAnalyticsView(props: {
  analytics: AnalyticsReport
  t: (key: string) => string
  days: number
  onDays: (days: number) => void
}): ReactNode {
  const { analytics, t, days, onDays } = props
  const [tab, setTab] = useState<Tab>('models')
  const summary = analytics.summary

  return (
    <>
      <div className="oc-analytics-head">
        <h3 className="oc-card-title">{t('usageAnalytics')}</h3>
        <div className="oc-row">
          <select
            className="oc-select"
            value={String(days)}
            onChange={(event) => onDays(Number(event.target.value))}
            aria-label={t('days')}
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
          <div className="oc-tabs" role="tablist">
            {(['models', 'days', 'sessions'] as const).map((entry) => (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={tab === entry}
                className={`oc-tab${tab === entry ? ' oc-tab-active' : ''}`}
                onClick={() => setTab(entry)}
              >
                {t(entry)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="oc-kpi-grid">
        <Kpi label={t('requests')} value={String(summary.requests)} />
        <Kpi label={t('tokens')} value={compact(summary.tokens)} />
        <Kpi
          label={t('successRate')}
          value={summary.successRate === null ? '—' : `${Math.round(summary.successRate)}%`}
          title="Recorded session steps; failed attempts are not exposed by the local projection."
        />
        <Kpi label={t('input')} value={compact(summary.inputTokens)} />
        <Kpi label={t('output')} value={compact(summary.outputTokens)} />
        <Kpi
          label={t('reasoning')}
          value={summary.reasoningTokens === null ? '—' : compact(summary.reasoningTokens)}
          title="Reasoning tokens are not exposed by the local session projection."
        />
        <Kpi label={t('cacheRead')} value={compact(summary.cacheReadTokens)} />
        <Kpi label={t('cacheWrite')} value={compact(summary.cacheWriteTokens)} />
        <Kpi label={t('avgTtft')} value={ms(summary.avgTtftMs)} />
        <Kpi label={t('avgLatency')} value={ms(summary.avgLatencyMs)} />
        <Kpi
          label={t('errors')}
          value={summary.errors === null ? '—' : String(summary.errors)}
          title="The local projection does not expose failed attempts."
        />
      </div>

      <p className="oc-hint">{t('analyticsHint')}</p>
      {tab === 'models' ? modelRows(analytics, t) : null}
      {tab === 'days' ? dayRows(analytics, t) : null}
      {tab === 'sessions' ? sessionRows(analytics, t) : null}
    </>
  )
}
