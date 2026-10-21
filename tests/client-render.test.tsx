import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AnalyticsReport, RequestHeatmap } from '../src/client/api.ts'
import { RequestHeatmapView } from '../src/client/heatmap.tsx'
import { QuotaPanel } from '../src/client/quota-card.tsx'
import { OpenCodeSettingsPage } from '../src/client/settings-page.tsx'
import { UsageAnalyticsView } from '../src/client/usage-analytics.tsx'
import { GO_PROVIDER } from '../src/provider-ids.ts'

const t = (key: string): string => key

function analytics(): AnalyticsReport {
  return {
    since: 0,
    scannedSessions: 1,
    matchedSessions: 1,
    models: [{
      provider: GO_PROVIDER,
      model: 'model-a',
      sessions: 1,
      turns: 1,
      steps: 2,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      priced: false,
      partial: false,
      free: true,
      llmMs: 20,
      ttftMs: 10,
      ttftSteps: 2,
      decodeMs: 10,
    }],
    summary: {
      sessions: 1,
      requests: 2,
      tokens: 150,
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: null,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
      priced: false,
      partial: false,
      free: true,
      avgTtftMs: 5,
      avgLatencyMs: 10,
      errors: null,
      successRate: null,
    },
    days: [],
    sessions: [],
  }
}

function heatmap(): RequestHeatmap {
  const hours = Array.from({ length: 24 }, () => 0)
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  return {
    since: 0,
    total: 3,
    hours,
    grid,
    firstAt: 1,
    lastAt: 2,
    models: [],
    accounts: [{
      account: 'Go #2',
      total: 3,
      errors: 1,
      avgLatencyMs: 120,
      avgTtftMs: 30,
      hours,
      grid,
    }],
  }
}

test('renders analytics and heatmap client components', () => {
  const usage = renderToStaticMarkup(
    <UsageAnalyticsView analytics={analytics()} t={t} days={7} onDays={() => {}} />,
  )
  assert.match(usage, /usageAnalytics/)
  assert.match(usage, /model-a/)
  assert.match(usage, /requests/)

  const heat = renderToStaticMarkup(<RequestHeatmapView heatmap={heatmap()} t={t} />)
  assert.match(heat, /accountLabel/)
  assert.match(heat, /Go #2/)
  assert.match(heat, /120ms/)
  assert.match(heat, /30ms/)
})

test('renders settings and quota panel initial states without a browser', () => {
  const settings = renderToStaticMarkup(<OpenCodeSettingsPage t={t} />)
  assert.match(settings, /loading/)

  const panel = renderToStaticMarkup(<QuotaPanel t={t} />)
  assert.match(panel, /quotaTitle/)
  assert.match(panel, /routingEmpty/)
})
