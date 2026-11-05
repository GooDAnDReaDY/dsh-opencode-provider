import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

import type { OpenCodeAdapter } from './adapter.ts'
import { commandCopy, type CommandCopy } from './command-copy.ts'
import { effectiveModel } from './catalog.ts'
import type { ResolvedConfig } from './config.ts'
import type { KeyPool, ResolvedKey } from './credentials.ts'
import { CONSOLE_PROVIDER, GO_PROVIDER } from './provider-ids.ts'
import { formatRequests, limitsFor } from './subscription-limits.ts'
import type { UsageResult, UsageWindow } from './usage.ts'

export interface CommandDeps {
  readonly config: () => ResolvedConfig
  readonly pool: KeyPool
  readonly usage: (provider: string, key?: string) => Promise<UsageResult | undefined>
  readonly adapter: OpenCodeAdapter
  readonly locale: () => 'en' | 'zh'
}

function bar(percent: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${clamped.toFixed(0)}%`
}

function reset(iso: string | undefined, copy: CommandCopy): string {
  if (iso === undefined) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return ` · ${copy.resets} ${date.toISOString().replace('T', ' ').slice(0, 16)}Z`
}

function windowLine(label: string, window: UsageWindow | undefined, copy: CommandCopy): string | undefined {
  if (window === undefined) return undefined
  const status = window.status === undefined || window.status === 'ok' ? '' : ` (${window.status})`
  return `${label}: ${bar(window.percentUsed)}${status}${reset(window.resetsAt, copy)}`
}

function percent(window: UsageWindow | undefined): string {
  if (window === undefined) return '—'
  const status = window.status === undefined || window.status === 'ok' ? '' : ` (${window.status})`
  return `${window.percentUsed.toFixed(0)}%${status}`
}

function summary(report: UsageResult['report']): string {
  if (report === undefined) return ''
  const windows = report.windows
  return [
    `5h ${percent(windows.fiveHour)}`,
    `wk ${percent(windows.weekly)}`,
    `mo ${percent(windows.monthly)}`,
  ].join(' / ')
}

function relative(until: number): string {
  const delta = Math.max(0, until - Date.now())
  if (delta >= 86_400_000) return `${Math.round(delta / 86_400_000)}d`
  if (delta >= 3_600_000) return `${Math.round(delta / 3_600_000)}h`
  return `${Math.max(1, Math.round(delta / 60_000))}m`
}

async function accountsText(deps: CommandDeps, copy: CommandCopy): Promise<string> {
  const lines: string[] = []
  for (const provider of [GO_PROVIDER, CONSOLE_PROVIDER] as const) {
    let keys: readonly ResolvedKey[]
    try {
      keys = await deps.pool.resolveAll(provider)
    } catch {
      lines.push(`${provider}: ${copy.noCredential}`)
      continue
    }
    if (keys.length === 0) {
      lines.push(`${provider}: ${copy.noCredential}`)
      continue
    }
    const active = keys.find((entry) => deps.adapter.accountHealth(entry.key) === undefined)
    lines.push(`${provider}:`)
    for (const [index, entry] of keys.entries()) {
      const health = deps.adapter.accountHealth(entry.key)
      const usage = provider === GO_PROVIDER ? await deps.usage(provider, entry.key) : undefined
      const tags = [
        entry.source,
        entry === active ? copy.active : '',
        health === undefined ? '' : `${copy.cooling} ${health.reason} ${relative(health.coolingUntil)}`,
        usage?.report === undefined ? (usage?.error ?? '') : summary(usage.report),
      ].filter((tag) => tag !== '')
      lines.push(`  ${index + 1}. ${entry.label ?? 'default'}: ${tags.join(' · ')}`)
    }
  }
  return lines.join('\n')
}

function rulesText(deps: CommandDeps, copy: CommandCopy): string {
  const rules = deps.config().modelAccountRules
  if (rules.length === 0) return copy.noRules
  return rules.map((rule) => `${rule.pattern} → ${rule.account}`).join('\n')
}

async function modelsText(deps: CommandDeps, copy: CommandCopy): Promise<string> {
  const config = deps.config()
  try {
    const models = await deps.adapter.listModels(GO_PROVIDER, { unfiltered: true })
    if (models.length === 0) return copy.noModels
    return models.map((model) => {
      const meta = effectiveModel(model.id, config)
      const limits = limitsFor(model.id)
      const plan = meta.free ? 'FREE' : limits === undefined ? 'Console' : 'Go'
      const tags = [
        plan,
        limits === undefined
          ? ''
          : `${copy.fiveHour} ${formatRequests(limits.go.fiveHour)} / ${copy.weekly} ${formatRequests(limits.go.weekly)} / ${copy.monthly} ${formatRequests(limits.go.monthly)}`,
      ].filter((tag) => tag !== '')
      return `- ${model.id}${tags.length === 0 ? '' : ` · ${tags.join(' · ')}`}`
    }).join('\n')
  } catch (error) {
    return `${copy.modelsUnavailable}: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function testText(deps: CommandDeps, model: string, copy: CommandCopy): Promise<{ ok: boolean; text: string }> {
  const started = Date.now()
  let text = ''
  try {
    for await (const chunk of deps.adapter.stream({
      provider: GO_PROVIDER,
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly OK.' }] }],
      maxTokens: 16,
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
    }
    return {
      ok: true,
      text: `${model}: OK in ${Date.now() - started} ms${text === '' ? '' : ` · ${text.slice(0, 80)}`}`,
    }
  } catch (error) {
    return {
      ok: false,
      text: `${model}: ${copy.testFailed} — ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function statusText(deps: CommandDeps, copy: CommandCopy): Promise<string> {
  const config = deps.config()
  const rules = config.modelAccountRules.length === 0
    ? copy.none
    : config.modelAccountRules.map((rule) => `${rule.pattern} → ${rule.account}`).join(', ')
  return [
    copy.provider,
    await accountsText(deps, copy),
    `${copy.rules}: ${rules}`,
    `${copy.auth}: ${config.openCodeAuthEntry} · ${config.apiKeyEnv}`,
  ].filter((line) => line !== '').join('\n')
}

export function applyCommands(ctx: Context, deps: CommandDeps): void {
  ctx.commands.register({
    name: 'opencode',
    description: 'OpenCode / OpenCode Go status, accounts, quotas, models and rules',
    input: { hint: 'status | usage | accounts | models | rules | test [model]' },
    handler: async (invocation) => {
      const copy = commandCopy(deps.locale())
      const raw = invocation.rawInput.trim()
      const parts = raw === '' ? ['status'] : raw.split(/\s+/)
      const verb = parts[0] ?? 'status'
      const arg = parts.slice(1).join(' ').trim()

      switch (verb.toLowerCase()) {
        case 'status':
          return { kind: 'success', text: await statusText(deps, copy) }
        case 'usage': {
          const usage = await deps.usage(GO_PROVIDER)
          if (usage?.report === undefined) {
            return { kind: 'error', text: `${copy.quotaUnavailable}: ${usage?.error ?? 'no report'}` }
          }
          const windows = usage.report.windows
          const text = [
            windowLine(copy.fiveHour, windows.fiveHour, copy),
            windowLine(copy.weekly, windows.weekly, copy),
            windowLine(copy.monthly, windows.monthly, copy),
          ].filter((line): line is string => line !== undefined).join('\n')
          return { kind: 'success', text: text === '' ? copy.noWindows : text }
        }
        case 'accounts':
          return { kind: 'success', text: await accountsText(deps, copy) }
        case 'models':
          return { kind: 'success', text: await modelsText(deps, copy) }
        case 'rules':
          return { kind: 'success', text: rulesText(deps, copy) }
        case 'test': {
          const result = await testText(deps, arg === '' ? 'deepseek-v4.1-flash' : arg, copy)
          return result.ok
            ? { kind: 'success', text: result.text }
            : { kind: 'error', text: result.text }
        }
        default:
          return {
            kind: 'error',
            text: `${copy.unknown} "${verb}". ${copy.rules}: status | usage | accounts | models | rules | test [model]`,
          }
      }
    },
  })
}
