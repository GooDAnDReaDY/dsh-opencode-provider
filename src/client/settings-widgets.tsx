import type { ReactNode } from 'react'

import type { UsageWindow } from './api.ts'
import { formatRequests, type PlanLimits } from '../subscription-limits.ts'

export function Field(props: {
  label: string
  hint?: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'number'
  placeholder?: string
  list?: string
}): ReactNode {
  return (
    <label className="oc-field">
      <span className="oc-label">{props.label}</span>
      <input
        className="oc-input"
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        list={props.list}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.hint === undefined ? null : <span className="oc-hint">{props.hint}</span>}
    </label>
  )
}

export function limitsCell(plan: PlanLimits): ReactNode {
  return (
    <>
      {plan.monthlyUsd === 'unlimited' ? '∞' : `$${plan.monthlyUsd}`}/mo
      <br />
      {formatRequests(plan.fiveHour)}/{formatRequests(plan.weekly)}/{formatRequests(plan.monthly)} req
    </>
  )
}

export function untilText(epoch: number): string {
  const delta = Math.max(0, epoch - Date.now())
  if (delta >= 86_400_000) return `${Math.round(delta / 86_400_000)}d`
  if (delta >= 3_600_000) return `${Math.round(delta / 3_600_000)}h`
  return `${Math.max(1, Math.round(delta / 60_000))}m`
}

export function usageChip(label: string, window: UsageWindow | undefined): ReactNode {
  if (window === undefined) return null
  const value = Math.round(window.percentUsed)
  const className = value >= 90 ? 'oc-badge-bad' : value >= 75 ? 'oc-badge-warn' : 'oc-badge-ok'
  return <span className={`oc-badge ${className}`}>{label} {value}%</span>
}

export function accountMark(account: { mark: string; coolingUntil: number } | undefined, t: (key: string) => string): string | undefined {
  if (account === undefined || account.mark === '') return undefined
  if (account.mark === 'invalid-credential') return t('markInvalid')
  const label = account.mark === 'quota'
    ? t('markQuota')
    : account.mark === 'rate-limit'
      ? t('markRateLimit')
      : t('markTransport')
  if (account.coolingUntil <= 0) return label
  return `${label} · ${untilText(account.coolingUntil)}`
}
