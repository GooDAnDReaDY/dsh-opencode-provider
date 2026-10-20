import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

import type { OpenCodeAdapter } from './adapter.ts'
import { effectiveModel } from './catalog.ts'
import type { ResolvedConfig } from './config.ts'
import type { KeyPool, ResolvedKey } from './credentials.ts'
import { formatRequests, limitsFor } from './subscription-limits.ts'
import type { UsageResult, UsageWindow } from './usage.ts'

export interface CommandDeps {
  readonly config: () => ResolvedConfig
  readonly pool: KeyPool
  readonly usage: (provider: string, key?: string) => Promise<UsageResult | undefined>
  readonly adapter: OpenCodeAdapter
}

function bar(percent: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${clamped.toFixed(0)}%`
}

function reset(iso: string | undefined): string {
  if (iso === undefined) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return ` · resets ${date.toISOString().replace('T', ' ').slice(0, 16)}Z`
}

function windowLine(label: string, window: UsageWindow | undefined): string | undefined {
  if (window === undefined) return undefined
  const status = window.status === undefined || window.status === 'ok' ? '' : ` (${window.status})`
  return `${label}: ${bar(window.percentUsed)}${status}${reset(window.resetsAt)}`
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

async function accountsText(deps: CommandDeps): Promise<string> {
  const lines: string[] = []
  for (const provider of ['opencode-go', 'opencode'] as const) {
    let keys: readonly ResolvedKey[]
    try {
      keys = await deps.pool.resolveAll(provider)
    } catch {
      lines.push(`${provider}: no credential`)
      continue
    }
    if (keys.length === 0) {
      lines.push(`${provider}: no credential`)
      continue
    }
    const active = keys.find((entry) => deps.adapter.accountHealth(entry.key) === undefined)
    lines.push(`${provider}:`)
    for (const [index, entry] of keys.entries()) {
      const health = deps.adapter.accountHealth(entry.key)
      const usage = provider === 'opencode-go' ? await deps.usage(provider, entry.key) : undefined
      const tags = [
        entry.source,
        entry === active ? 'active' : '',
        health === undefined ? '' : `cooling ${health.reason} ${relative(health.coolingUntil)}`,
        usage?.report === undefined ? (usage?.error ?? '') : summary(usage.report),
      ].filter((tag) => tag !== '')
      lines.push(`  ${index + 1}. ${entry.label ?? 'default'}: ${tags.join(' · ')}`)
    }
  }
  return lines.join('\n')
}

function rulesText(deps: CommandDeps): string {
  const rules = deps.config().modelAccountRules
  if (rules.length === 0) return 'No model → account rules.'
  return rules.map((rule) => `${rule.pattern} → ${rule.account}`).join('\n')
}

async function modelsText(deps: CommandDeps): Promise<string> {
  const config = deps.config()
  try {
    const models = await deps.adapter.listModels('opencode-go', { unfiltered: true })
    if (models.length === 0) return 'No models.'
    return models.map((model) => {
      const meta = effectiveModel(model.id, config)
      const limits = limitsFor(model.id)
      const plan = meta.free ? 'FREE' : limits === undefined ? 'Console' : 'Go'
      const tags = [
        plan,
        limits === undefined
          ? ''
          : `5h ${formatRequests(limits.go.fiveHour)} / wk ${formatRequests(limits.go.weekly)} / mo ${formatRequests(limits.go.monthly)}`,
      ].filter((tag) => tag !== '')
      return `- ${model.id}${tags.length === 0 ? '' : ` · ${tags.join(' · ')}`}`
    }).join('\n')
  } catch (error) {
    return `Models unavailable: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function testText(deps: CommandDeps, model: string): Promise<{ ok: boolean; text: string }> {
  const started = Date.now()
  let text = ''
  try {
    for await (const chunk of deps.adapter.stream({
      provider: 'opencode-go',
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
      text: `${model}: failed — ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function statusText(deps: CommandDeps): Promise<string> {
  const config = deps.config()
  const rules = config.modelAccountRules.length === 0
    ? 'none'
    : config.modelAccountRules.map((rule) => `${rule.pattern} → ${rule.account}`).join(', ')
  return [
    'OpenCode provider',
    await accountsText(deps),
    `Rules: ${rules}`,
    `Auth: ${config.openCodeAuthEntry} · ${config.apiKeyEnv}`,
  ].filter((line) => line !== '').join('\n')
}

export function applyCommands(ctx: Context, deps: CommandDeps): void {
  ctx.commands.register({
    name: 'opencode',
    description: 'OpenCode / OpenCode Go status, accounts, quotas, models and rules',
    input: { hint: 'status | usage | accounts | models | rules | test [model]' },
    handler: async (invocation) => {
      const raw = invocation.rawInput.trim()
      const parts = raw === '' ? ['status'] : raw.split(/\s+/)
      const verb = parts[0] ?? 'status'
      const arg = parts.slice(1).join(' ').trim()

      switch (verb.toLowerCase()) {
        case 'status':
          return { kind: 'success', text: await statusText(deps) }
        case 'usage': {
          const usage = await deps.usage('opencode-go')
          if (usage?.report === undefined) {
            return { kind: 'error', text: `Quota unavailable: ${usage?.error ?? 'no report'}` }
          }
          const windows = usage.report.windows
          const text = [
            windowLine('5h     ', windows.fiveHour),
            windowLine('weekly ', windows.weekly),
            windowLine('monthly', windows.monthly),
          ].filter((line): line is string => line !== undefined).join('\n')
          return { kind: 'success', text: text === '' ? 'No quota windows returned.' : text }
        }
        case 'accounts':
          return { kind: 'success', text: await accountsText(deps) }
        case 'models':
          return { kind: 'success', text: await modelsText(deps) }
        case 'rules':
          return { kind: 'success', text: rulesText(deps) }
        case 'test': {
          const result = await testText(deps, arg === '' ? 'deepseek-v4.1-flash' : arg)
          return result.ok
            ? { kind: 'success', text: result.text }
            : { kind: 'error', text: result.text }
        }
        default:
          return {
            kind: 'error',
            text: `Unknown /opencode argument "${verb}". Use status, usage, accounts, models, rules, or test [model].`,
          }
      }
    },
  })
}
