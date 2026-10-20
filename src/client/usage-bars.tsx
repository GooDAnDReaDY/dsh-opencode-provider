import type { ReactNode } from 'react'

import type { UsageState, UsageWindow } from './api.ts'

function percentClass(percent: number): string {
  if (percent >= 90) return 'oc-bar-fill oc-bar-fill-bad'
  if (percent >= 75) return 'oc-bar-fill oc-bar-fill-warn'
  return 'oc-bar-fill'
}

function reset(iso: string | undefined): string {
  if (iso === undefined) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const delta = date.getTime() - Date.now()
  const relative = delta <= 0
    ? 'now'
    : delta >= 86_400_000
      ? `${Math.round(delta / 86_400_000)}d`
      : delta >= 3_600_000
        ? `${Math.round(delta / 3_600_000)}h`
        : `${Math.max(1, Math.round(delta / 60_000))}m`
  return `${date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} (${relative})`
}

function Row(props: { label: string; window: UsageWindow | undefined }): ReactNode {
  const { label, window } = props
  if (window === undefined) return null
  return (
    <div className="oc-bar-row">
      <span>{label}</span>
      <div className="oc-bar">
        <div className={percentClass(window.percentUsed)} style={{ width: `${Math.max(0, Math.min(100, window.percentUsed))}%` }} />
      </div>
      <span title={window.resetsAt === undefined ? undefined : new Date(window.resetsAt).toLocaleString()}>
        {window.percentUsed.toFixed(0)}%
        {window.resetsAt === undefined ? '' : ` · ${reset(window.resetsAt)}`}
      </span>
    </div>
  )
}

export function UsageBars(props: { usage: UsageState | null; t: (key: string) => string }): ReactNode {
  const { usage, t } = props
  if (usage === null || usage.report === undefined) {
    return <p className="oc-hint">{usage?.error === undefined ? t('noUsage') : `${t('usageError')}: ${usage.error}`}</p>
  }
  const windows = usage.report.windows
  return (
    <div className="oc-bars">
      <Row label={t('fiveHour')} window={windows.fiveHour} />
      <Row label={t('weekly')} window={windows.weekly} />
      <Row label={t('monthly')} window={windows.monthly} />
    </div>
  )
}
