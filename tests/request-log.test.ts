import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  compactRequestLog,
  flushRequestLog,
  readRequestHeatmap,
  recordRequest,
  requestLogPath,
} from '../src/request-log.ts'

test('aggregates requests per account', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-opencode-accounts-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const at = new Date(2026, 0, 5, 14, 30).getTime()
  try {
    recordRequest('opencode-go', 'm', at, undefined, 'default')
    recordRequest('opencode-go', 'm', at + 60_000, undefined, 'Go #2')
    recordRequest('opencode-go', 'm', at + 120_000, undefined, 'Go #2')
    await flushRequestLog()
    const heatmap = await readRequestHeatmap(7, at + 200_000)
    const fallback = heatmap.accounts.find((entry) => entry.account === 'default')
    const second = heatmap.accounts.find((entry) => entry.account === 'Go #2')
    assert.equal(fallback?.total, 1)
    assert.equal(second?.total, 2)
    assert.equal(second?.hours[14], 2)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

test('aggregates per-account errors and latency', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-opencode-stats-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const at = new Date(2026, 0, 5, 14, 30).getTime()
  try {
    recordRequest('opencode-go', 'm', at, undefined, 'default', 'rotation', {
      ok: false,
      latencyMs: 100,
      error: 'QUOTA',
    })
    recordRequest('opencode-go', 'm', at + 1, undefined, 'default', 'rotation', {
      ok: true,
      latencyMs: 300,
      ttftMs: 120,
    })
    await flushRequestLog()
    const heatmap = await readRequestHeatmap(7, at + 200_000)
    const account = heatmap.accounts.find((entry) => entry.account === 'default')
    assert.equal(account?.total, 2)
    assert.equal(account?.errors, 1)
    assert.equal(account?.avgLatencyMs, 200)
    assert.equal(account?.avgTtftMs, 120)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

test('records requests and builds a local weekday/hour heatmap', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-opencode-log-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const monday = new Date(2026, 0, 5, 14, 30).getTime()
    const tuesday = new Date(2026, 0, 6, 9, 15).getTime()
    const old = new Date(2026, 0, 8, 2, 0).getTime() - 40 * 86_400_000
    const now = new Date(2026, 0, 10, 12, 0).getTime()

    recordRequest('opencode-go', 'm', monday)
    recordRequest('opencode-go', 'm', tuesday)
    recordRequest('opencode-go', 'other', monday + 15 * 60_000)
    recordRequest('opencode-go', 'm', old)
    recordRequest('opencode-go', 'm', monday, 'session-title')
    recordRequest('opencode-go', 'm', monday)
    await flushRequestLog()
    await appendFile(requestLogPath(), '{not-json\n', 'utf8')

    const heatmap = await readRequestHeatmap(7, now)
    assert.equal(heatmap.total, 3)
    assert.equal(heatmap.hours[14], 2)
    assert.equal(heatmap.hours[9], 1)
    assert.equal(heatmap.grid[0]?.[14], 2)
    assert.equal(heatmap.grid[1]?.[9], 1)
    assert.equal(heatmap.grid.flat().reduce((sum, value) => sum + value, 0), 3)
    assert.equal(heatmap.firstAt, monday)
    assert.equal(heatmap.lastAt, tuesday)

    const m = heatmap.models.find((entry) => entry.model === 'm')
    const other = heatmap.models.find((entry) => entry.model === 'other')
    assert.equal(heatmap.models.length, 2)
    assert.equal(m?.total, 2)
    assert.equal(m?.grid[0]?.[14], 1)
    assert.equal(m?.grid[1]?.[9], 1)
    assert.equal(other?.total, 1)
    assert.equal(other?.grid[0]?.[14], 1)
    await compactRequestLog(0, 2)
    const compacted = await readFile(requestLogPath(), 'utf8')
    assert.equal(compacted.trim().split('\n').length, 2)
    assert.ok(requestLogPath().startsWith(home))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})
