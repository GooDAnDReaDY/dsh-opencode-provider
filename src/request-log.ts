import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_LOG_BYTES = 2 * 1024 * 1024
const KEEP_LINES = 5_000
const COMPACT_EVERY = 200

export interface RequestRecord {
  at: number
  provider: string
  model: string
  purpose?: string
  account?: string
  reason?: string
}

export interface ModelRequestHeatmap {
  provider: string
  model: string
  total: number
  hours: number[]
  grid: number[][]
}

export interface AccountRequestHeatmap {
  account: string
  total: number
  hours: number[]
  grid: number[][]
}

export interface RequestHeatmap {
  since: number
  total: number
  /** Requests per hour of day, local time. */
  hours: number[]
  /** Monday-first weekday × hour grid, local time. */
  grid: number[][]
  firstAt: number | null
  lastAt: number | null
  models: ModelRequestHeatmap[]
  accounts: AccountRequestHeatmap[]
}

/** Append-only request metadata. The path is local; no prompt or response is stored. */
export function requestLogPath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-opencode', 'requests.jsonl')
}

let queue: Promise<void> = Promise.resolve()
let readyDirectory = ''
let appends = 0

export function recordRequest(
  provider: string,
  model: string,
  at = Date.now(),
  purpose?: string,
  account?: string,
  reason?: string,
): void {
  const line = `${JSON.stringify({
    at,
    provider,
    model,
    ...(purpose === undefined ? {} : { purpose }),
    ...(account === undefined ? {} : { account }),
    ...(reason === undefined ? {} : { reason }),
  })}\n`
  queue = queue.then(async () => {
    try {
      const path = requestLogPath()
      const directory = dirname(path)
      if (readyDirectory !== directory) {
        await mkdir(directory, { recursive: true })
        readyDirectory = directory
      }
      await appendFile(path, line, 'utf8')
      appends += 1
      if (appends % COMPACT_EVERY === 0) await compactRequestLog()
    } catch {
      // Analytics must never break inference.
    }
  })
}

/** Await pending appends (tests and shutdown). */
export async function flushRequestLog(): Promise<void> {
  await queue
}

/** Best-effort compaction: once the file is large, keep the newest lines. */
export async function compactRequestLog(
  maxBytes = MAX_LOG_BYTES,
  keepLines = KEEP_LINES,
): Promise<void> {
  const path = requestLogPath()
  try {
    const info = await stat(path)
    if (info.size <= maxBytes) return
    const text = await readFile(path, 'utf8')
    const lines = text.split('\n').filter((line) => line !== '')
    if (lines.length <= keepLines) return
    await writeFile(path, `${lines.slice(-keepLines).join('\n')}\n`, 'utf8')
  } catch {
    // Best-effort: a failed compaction leaves the append-only log intact.
  }
}

export async function readRequestHeatmap(days: number, now = Date.now()): Promise<RequestHeatmap> {
  const clamped = Math.max(1, Math.min(365, Math.trunc(days)))
  const since = now - clamped * DAY_MS
  const hours = Array.from({ length: 24 }, () => 0)
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  const models = new Map<string, ModelRequestHeatmap>()
  const accounts = new Map<string, AccountRequestHeatmap>()
  const seen = new Set<string>()
  let total = 0
  let firstAt: number | null = null
  let lastAt: number | null = null

  let text: string
  try {
    text = await readFile(requestLogPath(), 'utf8')
  } catch {
    return { since, total, hours, grid, firstAt, lastAt, models: [], accounts: [] }
  }

  for (const line of text.split('\n')) {
    if (line === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue
    const at = (parsed as { at?: unknown }).at
    if (typeof at !== 'number' || !Number.isFinite(at) || at < since || at > now + 60_000) continue
    const purpose = typeof (parsed as { purpose?: unknown }).purpose === 'string'
      ? (parsed as { purpose: string }).purpose
      : ''
    if (purpose === 'session-title' || purpose === 'compaction') continue
    const provider = typeof (parsed as { provider?: unknown }).provider === 'string'
      ? (parsed as { provider: string }).provider
      : ''
    const model = typeof (parsed as { model?: unknown }).model === 'string'
      ? (parsed as { model: string }).model
      : ''
    const account = typeof (parsed as { account?: unknown }).account === 'string'
      && (parsed as { account: string }).account !== ''
      ? (parsed as { account: string }).account
      : 'unknown'
    const key = `${at}|${provider}|${model}|${account}`
    if (seen.has(key)) continue
    seen.add(key)

    const date = new Date(at)
    const hour = date.getHours()
    const day = (date.getDay() + 6) % 7
    const row = grid[day]
    hours[hour] = (hours[hour] ?? 0) + 1
    if (row !== undefined) row[hour] = (row[hour] ?? 0) + 1

    if (provider !== '' && model !== '') {
      const modelKey = `${provider}/${model}`
      let entry = models.get(modelKey)
      if (entry === undefined) {
        entry = {
          provider,
          model,
          total: 0,
          hours: Array.from({ length: 24 }, () => 0),
          grid: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
        }
        models.set(modelKey, entry)
      }
      entry.total += 1
      entry.hours[hour] = (entry.hours[hour] ?? 0) + 1
      const modelRow = entry.grid[day]
      if (modelRow !== undefined) modelRow[hour] = (modelRow[hour] ?? 0) + 1
    }

    let accountEntry = accounts.get(account)
    if (accountEntry === undefined) {
      accountEntry = {
        account,
        total: 0,
        hours: Array.from({ length: 24 }, () => 0),
        grid: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
      }
      accounts.set(account, accountEntry)
    }
    accountEntry.total += 1
    accountEntry.hours[hour] = (accountEntry.hours[hour] ?? 0) + 1
    const accountRow = accountEntry.grid[day]
    if (accountRow !== undefined) accountRow[hour] = (accountRow[hour] ?? 0) + 1

    total += 1
    if (firstAt === null || at < firstAt) firstAt = at
    if (lastAt === null || at > lastAt) lastAt = at
  }

  return {
    since,
    total,
    hours,
    grid,
    firstAt,
    lastAt,
    models: [...models.values()].sort((a, b) => b.total - a.total || a.model.localeCompare(b.model)),
    accounts: [...accounts.values()].sort((a, b) => b.total - a.total || a.account.localeCompare(b.account)),
  }
}
