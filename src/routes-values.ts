import type { TransportId } from './config.ts'

const TRANSPORTS = new Set<TransportId>(['openai-chat', 'openai-responses', 'anthropic', 'google'])

export function cleanAccounts(value: unknown): Array<{ label: string; apiKeyEnv: string }> {
  if (!Array.isArray(value)) return []
  const out: Array<{ label: string; apiKeyEnv: string }> = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    const apiKeyEnv = typeof record.apiKeyEnv === 'string' ? record.apiKeyEnv.trim() : ''
    if (label === '' && apiKeyEnv === '') continue
    out.push({ label: label === '' ? `account-${out.length + 2}` : label, apiKeyEnv })
  }
  return out
}

export function cleanStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
    : []
}

export function cleanModelAccountRules(value: unknown): Array<{ pattern: string; account: string }> {
  if (!Array.isArray(value)) return []
  const out: Array<{ pattern: string; account: string }> = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const pattern = typeof record.pattern === 'string' ? record.pattern.trim() : ''
    const account = typeof record.account === 'string' ? record.account.trim() : ''
    if (pattern === '' || account === '') continue
    out.push({ pattern, account })
  }
  return out
}

export function cleanBooleanRecord(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, boolean> = {}
  for (const [key, entry] of Object.entries(value)) if (typeof entry === 'boolean') out[key] = entry
  return out
}

export function cleanNumberRecord(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'number' && Number.isInteger(entry) && entry > 0) out[key] = entry
  }
  return out
}

export function cleanTransports(value: unknown): Record<string, TransportId> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, TransportId> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && TRANSPORTS.has(entry as TransportId)) out[key] = entry as TransportId
  }
  return out
}
