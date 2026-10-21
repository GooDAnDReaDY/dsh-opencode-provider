import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { GENERATED_MODELS } from './models.generated.ts'
import { PLUGIN_AND_LEGACY_PROVIDERS } from './provider-ids.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const CACHE_TTL_MS = 60_000
const MAX_FILES = 5_000

export interface SessionTokens {
  uncachedInputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export interface SessionMetadata {
  id?: string
  createdAt?: number
  lastPromptAt?: number
  usage?: SessionTokens
  lastUsed?: { provider?: string; model?: string } | null
  stats?: {
    turns?: number
    steps?: number
    llmMs?: number
    ttftMs?: number
    ttftSteps?: number
    decodeMs?: number
  }
}

export interface ModelUsageRow {
  provider: string
  model: string
  sessions: number
  turns: number
  steps: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  priced: boolean
  partial: boolean
  free: boolean
  llmMs: number
  ttftMs: number
  ttftSteps: number
  decodeMs: number
}

export interface AnalyticsSummary {
  sessions: number
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number | null
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  priced: boolean
  partial: boolean
  free: boolean
  avgTtftMs: number | null
  avgLatencyMs: number | null
  errors: number | null
  successRate: number | null
}

export interface DayUsageRow {
  date: string
  sessions: number
  requests: number
  tokens: number
  cost: number
  priced: boolean
  partial: boolean
  free: boolean
  avgTtftMs: number | null
}

export interface SessionUsageRow {
  id: string
  provider: string
  model: string
  at: number
  requests: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  priced: boolean
  partial: boolean
  free: boolean
  avgTtftMs: number | null
  avgLatencyMs: number | null
}

export interface AnalyticsReport {
  since: number
  scannedSessions: number
  matchedSessions: number
  models: ModelUsageRow[]
  summary: AnalyticsSummary
  days: DayUsageRow[]
  sessions: SessionUsageRow[]
}

interface ProjectionRow<T> {
  val?: T
}

interface ProjectionFile {
  record?: {
    identity?: { createdAt?: number }
    rows?: Record<string, ProjectionRow<unknown>>
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function obj(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read the numeric metadata out of one projection cache file. */
export function metadataOf(file: ProjectionFile): SessionMetadata | undefined {
  const record = file.record
  const rows = record?.rows
  if (record === undefined || rows === undefined) return undefined

  const usageRow = obj(rows.tokenUsage?.val)
  const usage = usageRow === undefined ? undefined : obj(usageRow.totals)
  const selection = obj(rows.modelSelection?.val)
  const lastUsed = selection === undefined ? undefined : obj(selection.lastUsed)
  const stats = obj(rows.sessionStats?.val)
  const list = obj(rows.sessionListMetadata?.val)
  const lastPromptAt = typeof list?.lastPromptAt === 'number' ? list.lastPromptAt : undefined
  const createdAt = record.identity?.createdAt

  return {
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(lastPromptAt === undefined ? {} : { lastPromptAt }),
    ...(usage === undefined
      ? {}
      : {
          usage: {
            uncachedInputTokens: count(usage.uncachedInputTokens),
            outputTokens: count(usage.outputTokens),
            cacheReadTokens: count(usage.cacheReadTokens),
            cacheWriteTokens: count(usage.cacheWriteTokens),
          },
        }),
    ...(lastUsed === undefined
      ? {}
      : {
          lastUsed: {
            ...(typeof lastUsed.provider === 'string' ? { provider: lastUsed.provider } : {}),
            ...(typeof lastUsed.model === 'string' ? { model: lastUsed.model } : {}),
          },
        }),
    ...(stats === undefined
      ? {}
      : {
          stats: {
            turns: count(stats.turns),
            steps: count(stats.steps),
            llmMs: count(stats.llmMs),
            ttftMs: count(stats.ttftMs),
            ttftSteps: count(stats.ttftSteps),
            decodeMs: count(stats.decodeMs),
          },
        }),
  }
}

function localDay(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Aggregate local session metadata by model, day and session. Only OpenCode
 * routes are counted, and only numeric metadata is read — titles and message
 * content never leave the projection cache. A session that switched models is
 * attributed to the model that served its last request, so the split is
 * approximate. Day grouping uses the session's last activity.
 */
export function aggregateSessions(
  sessions: readonly SessionMetadata[],
  days: number,
  now = Date.now(),
): AnalyticsReport {
  const since = now - days * DAY_MS
  const models = new Map<string, ModelUsageRow>()
  const daysMap = new Map<string, {
    date: string
    sessions: number
    requests: number
    tokens: number
    cost: number
    priced: boolean
    partial: boolean
    free: boolean
    ttftMs: number
    ttftSteps: number
  }>()
  const sessionRows: SessionUsageRow[] = []
  let matched = 0
  const total = {
    sessions: 0,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    priced: false,
    partial: false,
    free: true,
    llmMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
  }

  for (const session of sessions) {
    const provider = session.lastUsed?.provider
    const model = session.lastUsed?.model
    if (typeof provider !== 'string' || !PLUGIN_AND_LEGACY_PROVIDERS.has(provider) || model === undefined || model === '') {
      continue
    }
    const usage = session.usage
    if (usage === undefined) continue
    const input = count(usage.uncachedInputTokens)
    const output = count(usage.outputTokens)
    const cacheRead = count(usage.cacheReadTokens)
    const cacheWrite = count(usage.cacheWriteTokens)
    if (input + output + cacheRead + cacheWrite === 0) continue
    const at = session.lastPromptAt ?? session.createdAt ?? 0
    if (at < since) continue
    matched += 1

    const meta = GENERATED_MODELS[model]
    const priced = meta !== undefined
    const free = meta?.free === true
    const partial = cacheWrite > 0 || !priced
    const cost = priced && !free && meta !== undefined
      ? (input * meta.cost.input + output * meta.cost.output + cacheRead * meta.cost.cacheRead) / 1_000_000
      : 0

    const key = `${provider}/${model}`
    let row = models.get(key)
    if (row === undefined) {
      row = {
        provider,
        model,
        sessions: 0,
        turns: 0,
        steps: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
        priced,
        partial,
        free,
        llmMs: 0,
        ttftMs: 0,
        ttftSteps: 0,
        decodeMs: 0,
      }
      models.set(key, row)
    }
    const steps = session.stats?.steps ?? 0
    const ttftSteps = session.stats?.ttftSteps ?? 0
    row.sessions += 1
    row.turns += session.stats?.turns ?? 0
    row.steps += steps
    row.inputTokens += input
    row.outputTokens += output
    row.cacheReadTokens += cacheRead
    row.cacheWriteTokens += cacheWrite
    row.llmMs += session.stats?.llmMs ?? 0
    row.ttftMs += session.stats?.ttftMs ?? 0
    row.ttftSteps += ttftSteps
    row.decodeMs += session.stats?.decodeMs ?? 0
    row.partial = row.partial || partial
    if (priced && !free) row.cost += cost

    sessionRows.push({
      id: session.id ?? '',
      provider,
      model,
      at,
      requests: steps,
      tokens: input + output,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      cost,
      priced,
      partial,
      free,
      avgTtftMs: ttftSteps > 0 ? (session.stats?.ttftMs ?? 0) / ttftSteps : null,
      avgLatencyMs: steps > 0 ? (session.stats?.llmMs ?? 0) / steps : null,
    })

    const date = localDay(at)
    let day = daysMap.get(date)
    if (day === undefined) {
      day = {
        date,
        sessions: 0,
        requests: 0,
        tokens: 0,
        cost: 0,
        priced: false,
        partial: false,
        free: true,
        ttftMs: 0,
        ttftSteps: 0,
      }
      daysMap.set(date, day)
    }
    day.sessions += 1
    day.requests += steps
    day.tokens += input + output
    day.cost += cost
    day.priced = day.priced || priced
    day.partial = day.partial || partial
    day.free = day.free && free
    day.ttftMs += session.stats?.ttftMs ?? 0
    day.ttftSteps += ttftSteps

    total.sessions += 1
    total.requests += steps
    total.inputTokens += input
    total.outputTokens += output
    total.cacheReadTokens += cacheRead
    total.cacheWriteTokens += cacheWrite
    total.cost += cost
    total.priced = total.priced || priced
    total.partial = total.partial || partial
    total.free = total.free && free
    total.llmMs += session.stats?.llmMs ?? 0
    total.ttftMs += session.stats?.ttftMs ?? 0
    total.ttftSteps += ttftSteps
  }

  const summary: AnalyticsSummary = {
    sessions: total.sessions,
    requests: total.requests,
    tokens: total.inputTokens + total.outputTokens,
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    reasoningTokens: null,
    cacheReadTokens: total.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens,
    cost: total.cost,
    priced: total.priced,
    partial: total.partial,
    free: total.sessions > 0 && total.free,
    avgTtftMs: total.ttftSteps > 0 ? total.ttftMs / total.ttftSteps : null,
    avgLatencyMs: total.requests > 0 ? total.llmMs / total.requests : null,
    errors: null,
    successRate: null,
  }

  return {
    since,
    scannedSessions: sessions.length,
    matchedSessions: matched,
    models: [...models.values()].sort((a, b) => b.cost - a.cost
      || (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens)
      || a.model.localeCompare(b.model)),
    summary,
    days: [...daysMap.values()]
      .map((day) => ({
        date: day.date,
        sessions: day.sessions,
        requests: day.requests,
        tokens: day.tokens,
        cost: day.cost,
        priced: day.priced,
        partial: day.partial,
        free: day.free,
        avgTtftMs: day.ttftSteps > 0 ? day.ttftMs / day.ttftSteps : null,
      }))
      .sort((a, b) => b.date.localeCompare(a.date)),
    sessions: sessionRows.sort((a, b) => b.at - a.at),
  }
}

const cache = new Map<number, { at: number; report: AnalyticsReport }>()

function projectionDirectory(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'storages', 'session_projcache', 'sessions')
}

/** Read and aggregate the local projection cache; never waits on the network. */
export async function readModelAnalytics(days = 30): Promise<AnalyticsReport> {
  const clamped = Math.max(1, Math.min(365, Math.trunc(days)))
  const cached = cache.get(clamped)
  if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) return cached.report

  const dir = projectionDirectory()
  const sessions: SessionMetadata[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).slice(0, MAX_FILES)
    let cursor = 0
    const workers = Array.from({ length: Math.min(16, files.length) }, async () => {
      while (true) {
        const index = cursor
        cursor += 1
        const entry = files[index]
        if (entry === undefined) return
        try {
          const parsed = JSON.parse(await readFile(join(dir, entry.name), 'utf8')) as ProjectionFile
          const meta = metadataOf(parsed)
          if (meta !== undefined) {
            meta.id = entry.name.replace(/\.json$/i, '')
            sessions.push(meta)
          }
        } catch {
          // A half-written or foreign projection file is simply skipped.
        }
      }
    })
    await Promise.all(workers)
  } catch {
    // No projection cache yet: an empty report is the honest answer.
  }

  const report = aggregateSessions(sessions, clamped)
  cache.set(clamped, { at: Date.now(), report })
  return report
}

export function clearAnalyticsCache(): void {
  cache.clear()
}
