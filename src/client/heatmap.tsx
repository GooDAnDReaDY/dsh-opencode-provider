import { Fragment, type ReactNode, useState } from 'react'

import type { RequestHeatmap } from './api.ts'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function cellColor(value: number, max: number): string {
  if (value === 0 || max <= 0) return 'rgba(127,127,127,0.10)'
  const ratio = Math.min(1, value / max)
  const alpha = 0.16 + 0.74 * Math.sqrt(ratio)
  return `rgba(79,191,134,${alpha.toFixed(3)})`
}

function hourLabel(hour: number): string {
  return hour % 3 === 0 ? String(hour).padStart(2, '0') : ''
}

function pad(hour: number): string {
  return String(hour).padStart(2, '0')
}

function formatMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value)}ms`
}

export function RequestHeatmapView(props: {
  heatmap: RequestHeatmap | undefined
  t: (key: string) => string
}): ReactNode {
  const { heatmap, t } = props
  const [selected, setSelected] = useState('all')
  const [selectedAccount, setSelectedAccount] = useState('all')
  if (heatmap === undefined) return null
  const models = heatmap.models ?? []
  const accounts = heatmap.accounts ?? []
  const selectedModel = selectedAccount === 'all'
    ? models.find((entry) => `${entry.provider}/${entry.model}` === selected)
    : undefined
  const accountView = accounts.find((entry) => entry.account === selectedAccount)
  const view = accountView ?? selectedModel ?? heatmap
  const selectedKey = selectedModel === undefined ? 'all' : selected
  const max = Math.max(0, ...view.grid.flat())
  const maxHours = Math.max(0, ...view.hours)
  const peakHour = view.hours.reduce(
    (best, value, hour) => value > (view.hours[best] ?? 0) ? hour : best,
    0,
  )
  const peak = view.hours[peakHour] ?? 0

  return (
    <div className="oc-heat-wrap">
      <div className="oc-row">
        <span className="oc-badge">{view.total} {t('requests')}</span>
        {accounts.length > 1 ? (
          <select
            className="oc-select"
            value={selectedAccount}
            title={t('heatmapByAccount')}
            onChange={(event) => {
              setSelectedAccount(event.target.value)
              setSelected('all')
            }}
          >
            <option value="all">{t('heatmapAllAccounts')} ({heatmap.total})</option>
            {accounts.map((entry) => (
              <option key={entry.account} value={entry.account}>
                {entry.account} ({entry.total})
              </option>
            ))}
          </select>
        ) : null}
        {models.length > 1 ? (
          <select
            className="oc-select"
            value={selectedKey}
            title={t('heatmapModel')}
            disabled={selectedAccount !== 'all'}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="all">{t('heatmapAllModels')} ({heatmap.total})</option>
            {models.map((entry) => (
              <option key={`${entry.provider}/${entry.model}`} value={`${entry.provider}/${entry.model}`}>
                {entry.model} ({entry.total})
              </option>
            ))}
          </select>
        ) : null}
        {peak === 0
          ? null
          : <span className="oc-hint">{t('heatmapPeak')}: {pad(peakHour)}:00 · {peak}</span>}
      </div>
      {accounts.length === 0 ? null : (
        <div className="oc-table-scroll" style={{ marginTop: 8 }}>
          <table className="oc-table">
            <thead>
              <tr>
                <th>{t('accountLabel')}</th>
                <th>{t('requests')}</th>
                <th>{t('errors')}</th>
                <th>{t('latency')}</th>
                <th>{t('ttft')}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((entry) => (
                <tr key={entry.account}>
                  <td>{entry.account}</td>
                  <td>{entry.total}</td>
                  <td>{entry.errors}</td>
                  <td>{formatMs(entry.avgLatencyMs)}</td>
                  <td>{formatMs(entry.avgTtftMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="oc-heat-scroll">
        <div className="oc-heat">
          <span />
          {view.hours.map((_, hour) => (
            <span key={`h${hour}`} className="oc-heat-hour">{hourLabel(hour)}</span>
          ))}
          {view.grid.map((row, day) => (
            <Fragment key={`d${day}`}>
              <span className="oc-heat-day">{DAYS[day] ?? ''}</span>
              {row.map((value, hour) => (
                <span
                  key={`c${day}-${hour}`}
                  className="oc-heat-cell"
                  style={{ background: cellColor(value, max) }}
                  title={`${DAYS[day] ?? ''} ${pad(hour)}:00 — ${value}`}
                />
              ))}
            </Fragment>
          ))}
        </div>
        <p className="oc-hour-strip-head">{t('heatmapByHour')}</p>
        <div className="oc-hour-strip">
          <span />
          {view.hours.map((value, hour) => (
            <span key={`s${hour}`} className="oc-hour-col" title={`${pad(hour)}:00 — ${value}`}>
              <span
                className="oc-hour-bar"
                style={{
                  height: maxHours <= 0 ? '2px' : `${Math.max(2, Math.round(28 * value / maxHours))}px`,
                  background: cellColor(value, maxHours),
                }}
              />
            </span>
          ))}
        </div>
        <div className="oc-hour-labels">
          <span />
          {view.hours.map((_, hour) => (
            <span key={`l${hour}`}>{hourLabel(hour)}</span>
          ))}
        </div>
      </div>
      <div className="oc-heat-legend">
        <span>{t('heatmapLess')}</span>
        {[0.1, 0.3, 0.5, 0.7, 0.9].map((ratio) => (
          <span
            key={ratio}
            className="oc-heat-swatch"
            style={{ background: `rgba(79,191,134,${(0.16 + 0.74 * ratio).toFixed(3)})` }}
          />
        ))}
        <span>{t('heatmapMore')}</span>
      </div>
      {view.total === 0 ? <p className="oc-hint">{t('heatmapEmpty')}</p> : null}
      <p className="oc-hint">{t('heatmapHint')}</p>
    </div>
  )
}
