export type QuotaSeverity = 'ok' | 'warn' | 'critical'

export function quotaSeverity(percent: number): QuotaSeverity {
  if (percent >= 95) return 'critical'
  if (percent >= 80) return 'warn'
  return 'ok'
}
