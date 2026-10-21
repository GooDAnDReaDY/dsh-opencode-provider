export interface RunwayWindow {
  percentUsed: number
  resetsAt?: string
}

export interface RunwayWindows {
  fiveHour?: RunwayWindow
  weekly?: RunwayWindow
  monthly?: RunwayWindow
}

export type RunwayWindowName = keyof RunwayWindows

export type RunwaySummary =
  | { kind: 'unknown' }
  | { kind: 'safe' }
  | { kind: 'eta'; etaMs: number; window: RunwayWindowName }

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const DURATIONS: Record<RunwayWindowName, number> = {
  fiveHour: 5 * HOUR,
  weekly: 7 * DAY,
  monthly: 30 * DAY,
}

export interface RunwayEstimate {
  etaMs: number
  resetsAtMs: number
  exhaustsBeforeReset: boolean
}

function percentOf(window: RunwayWindow): number {
  const value = Number(window.percentUsed)
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}

/**
 * Estimate when one window reaches 100% at the average burn rate observed
 * since it started. The API exposes only the current percentage and reset
 * time; the start is derived from the known window length, so this is a
 * deliberately conservative, approximate runway.
 */
export function estimateRunway(
  window: RunwayWindow | undefined,
  durationMs: number,
  now = Date.now(),
): RunwayEstimate | undefined {
  if (window === undefined || window.resetsAt === undefined) return undefined
  const resetsAtMs = Date.parse(window.resetsAt)
  if (!Number.isFinite(resetsAtMs) || resetsAtMs <= now) return undefined
  const used = percentOf(window)
  const timeToReset = resetsAtMs - now
  if (used >= 100) return { etaMs: 0, resetsAtMs, exhaustsBeforeReset: true }

  const startedAt = resetsAtMs - durationMs
  const elapsed = now - startedAt
  if (elapsed <= 0) return undefined
  const rate = used / elapsed
  if (!Number.isFinite(rate) || rate <= 0) {
    return { etaMs: Number.POSITIVE_INFINITY, resetsAtMs, exhaustsBeforeReset: false }
  }
  const etaMs = (100 - used) / rate
  return { etaMs, resetsAtMs, exhaustsBeforeReset: etaMs < timeToReset }
}

/** Pick the window that is projected to run out first, if any. */
export function accountRunway(windows: RunwayWindows | undefined, now = Date.now()): RunwaySummary {
  if (windows === undefined) return { kind: 'unknown' }
  let best: { etaMs: number; window: RunwayWindowName } | undefined
  let known = 0
  for (const name of Object.keys(DURATIONS) as RunwayWindowName[]) {
    const estimate = estimateRunway(windows[name], DURATIONS[name], now)
    if (estimate === undefined) continue
    known += 1
    if (!estimate.exhaustsBeforeReset) continue
    if (best === undefined || estimate.etaMs < best.etaMs) {
      best = { etaMs: estimate.etaMs, window: name }
    }
  }
  if (best !== undefined) return { kind: 'eta', etaMs: best.etaMs, window: best.window }
  return known === 0 ? { kind: 'unknown' } : { kind: 'safe' }
}
