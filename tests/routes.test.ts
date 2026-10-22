import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'

import { resolveConfig } from '../src/config.ts'
import { applyRoutes, type RouteDeps } from '../src/routes.ts'
import type { OpenCodeAdapter } from '../src/adapter.ts'
import type { KeyPool } from '../src/credentials.ts'
import { CONSOLE_PROVIDER, GO_PROVIDER } from '../src/provider-ids.ts'
import type { UsageReader } from '../src/usage.ts'

interface Captured {
  status: number
  body: unknown
  headers: Record<string, string>
}

function localIpv4(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return undefined
}

function fakeResponse(): { res: unknown; captured: Promise<Captured> } {
  let resolve!: (value: Captured) => void
  const captured = new Promise<Captured>((done) => { resolve = done })
  const headers: Record<string, string> = {}
  let status = 0
  const res = {
    set statusCode(value: number) { status = value },
    get statusCode() { return status },
    setHeader(key: string, value: string) { headers[key] = value },
    end(chunk?: string) {
      resolve({
        status,
        body: chunk === undefined || chunk === '' ? undefined : JSON.parse(chunk) as unknown,
        headers,
      })
    },
  }
  return { res, captured }
}

async function call(
  handler: (req: unknown, res: unknown) => void | Promise<void>,
  options: {
    method?: string
    path?: string
    headers?: Record<string, string>
    body?: unknown
    remoteAddress?: string
  } = {},
): Promise<Captured> {
  const body = options.body === undefined ? [] : [Buffer.from(JSON.stringify(options.body))]
  const req = Readable.from(body) as Readable & {
    method?: string
    headers: Record<string, string>
    url?: string
    socket: { remoteAddress: string }
  }
  req.method = options.method ?? 'GET'
  req.url = options.path ?? '/'
  req.headers = { host: '127.0.0.1:3080', ...(options.headers ?? {}) }
  req.socket = { remoteAddress: options.remoteAddress ?? '127.0.0.1' }
  const { res, captured } = fakeResponse()
  await handler(req, res)
  return captured
}

function harness(overrides: { config?: Record<string, unknown>; heatmapError?: boolean } = {}) {
  const routes = new Map<string, (req: unknown, res: unknown) => void | Promise<void>>()
  const mutations: Array<{ ns: string; ops: unknown; revision: unknown }> = []
  const stored = new Map<string, string>()
  const tuiRefreshes = { count: 0 }

  const settings = {
    writable: true,
    describe: () => [{ ns: 'llm-opencode', revision: 7 }],
    mutate: async (ns: string, ops: unknown, revision: unknown) => {
      mutations.push({ ns, ops, revision })
    },
  }
  const credentials = {
    describe: async (ref: string) => ({ configured: stored.has(ref), writable: true }),
    set: async (ref: string, value: string) => { stored.set(ref, value) },
    unset: async (ref: string) => { stored.delete(ref) },
  }
  const ctx = {
    get: (name: string) => name === 'settings' ? settings : name === 'credentials' ? credentials : undefined,
    effect: (factory: () => unknown) => factory(),
  } as unknown as Context

  const web = {
    register: (route: { path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }) => {
      routes.set(route.path, route.handler)
      return () => {}
    },
  } as never

  const adapter = {
    listModels: async () => [{
      provider: 'opencode-go',
      id: 'deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      description: 'test',
      inputModalities: ['text'],
    }],
    async *stream() {
      yield { type: 'text-delta', index: 0, text: 'OK' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
    accountHealth: () => undefined,
    routingTrace: () => [],
  } as unknown as OpenCodeAdapter

  const pool = {
    resolve: async () => ({ key: 'secret', source: 'test', label: 'default' }),
    resolveAll: async () => [{ key: 'secret', source: 'test', label: 'default' }],
  } as KeyPool

  const usage = Object.assign(
    async () => ({
      report: { windows: { fiveHour: { percentUsed: 1 }, weekly: { percentUsed: 2 }, monthly: { percentUsed: 3 } } },
      checkedAt: Date.now(),
    }),
    { clear: () => {} },
  ) as UsageReader

  const config = resolveConfig({
    apiKeyEnv: 'OPENCODE_API_KEY',
    openCodeAuthEntry: 'test-entry-that-does-not-exist',
    ...(overrides.config ?? {}),
  })
  const deps: RouteDeps = {
    config: () => config,
    adapter,
    pool,
    usage,
    refreshTui: () => { tuiRefreshes.count += 1 },
    analytics: async (days) => ({
      since: Date.now() - days * 86_400_000,
      scannedSessions: 3,
      matchedSessions: 1,
      models: [{
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
        sessions: 1,
        turns: 2,
        steps: 4,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0.0001,
        priced: true,
        partial: false,
        free: false,
        llmMs: 1000,
        ttftMs: 100,
        ttftSteps: 2,
        decodeMs: 500,
      }],
      summary: {
        sessions: 1,
        requests: 2,
        tokens: 120,
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: null,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0.0001,
        priced: true,
        partial: false,
        free: false,
        avgTtftMs: 50,
        avgLatencyMs: 500,
        errors: null,
        successRate: null,
      },
      days: [{
        date: '2026-10-20',
        sessions: 1,
        requests: 2,
        tokens: 120,
        cost: 0.0001,
        priced: true,
        partial: false,
        free: false,
        avgTtftMs: 50,
      }],
      sessions: [{
        id: 'session-test',
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
        at: Date.now(),
        requests: 2,
        tokens: 120,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0.0001,
        priced: true,
        partial: false,
        free: false,
        avgTtftMs: 50,
        avgLatencyMs: 500,
      }],
    }),
    heatmap: async () => {
      if (overrides.heatmapError === true) throw new Error('heatmap failed')
      return {
        since: 0,
        total: 2,
        hours: Array.from({ length: 24 }, () => 0),
        grid: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
        firstAt: null,
        lastAt: null,
        models: [],
        accounts: [],
      }
    },
  }
  applyRoutes(ctx, web, deps)
  return { routes, mutations, stored, tuiRefreshes }
}

test('state route reports config, key, accounts, models and usage', async () => {
  const { routes } = harness()
  const state = await call(routes.get('/dsh-opencode/state')!, { path: '/dsh-opencode/state' })
  assert.equal(state.status, 200)
  const body = state.body as Record<string, any>
  assert.equal(body.config.apiKeyEnv, 'OPENCODE_API_KEY')
  assert.equal(body.accounts[0].label, 'default')
  assert.equal(body.models[0].id, 'deepseek-v4.1-flash')
  assert.equal(body.usage.report.windows.fiveHour.percentUsed, 1)
  assert.equal(body.accounts[0].usage.report.windows.monthly.percentUsed, 3)
  assert.equal(body.key.configured, true)
})

test('config route writes path ops with the current revision', async () => {
  const { routes, mutations, tuiRefreshes } = harness()
  const result = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: { patch: { showSidebarQuota: true, visibleModels: ['deepseek-v4.1-flash'] } },
  })
  assert.equal(result.status, 200)
  assert.equal(mutations.length, 1)
  assert.equal(mutations[0]?.ns, 'llm-opencode')
  assert.equal(mutations[0]?.revision, 7)
  const ops = mutations[0]?.ops as Array<{ op: string; path: string[]; value: unknown }>
  assert.deepEqual(ops.map((op) => op.path[0]).sort(), ['showSidebarQuota', 'visibleModels'].sort())
  assert.equal(tuiRefreshes.count, 1)
})

test('config route normalizes model-account rules', async () => {
  const { routes, mutations } = harness()
  const result = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: {
      patch: {
        modelAccountRules: [
          { pattern: ' *free* ', account: ' Go #2 ' },
          { pattern: '', account: 'x' },
        ],
      },
    },
  })
  assert.equal(result.status, 200)
  const ops = mutations[0]?.ops as Array<{ op: string; path: string[]; value: unknown }>
  const ruleOp = ops.find((op) => op.path[0] === 'modelAccountRules')
  assert.deepEqual(ruleOp?.value, [{ pattern: '*free*', account: 'Go #2' }])
})

test('auth-import can store an entry under an explicit credential ref', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-opencode-auth-'))
  const previous = process.env.XDG_DATA_HOME
  process.env.XDG_DATA_HOME = home
  try {
    await mkdir(join(home, 'opencode'), { recursive: true })
    await writeFile(
      join(home, 'opencode', 'auth.json'),
      JSON.stringify({ 'opencode-go': { key: 'auth-secret' } }),
      'utf8',
    )
    const { routes, stored } = harness()
    const result = await call(routes.get('/dsh-opencode/auth-import')!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { entry: 'opencode-go', ref: 'OPENCODE_AUTH_OPENCODE_GO' },
    })
    assert.equal(result.status, 200)
    assert.equal(stored.get('OPENCODE_AUTH_OPENCODE_GO'), 'auth-secret')
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

test('key route stores the key through the credentials seam', async () => {
  const { routes, stored } = harness()
  const result = await call(routes.get('/dsh-opencode/key')!, {
    method: 'POST',
    path: '/dsh-opencode/key',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: { key: 'oc_sk_test' },
  })
  assert.equal(result.status, 200)
  assert.equal(stored.get('OPENCODE_API_KEY'), 'oc_sk_test')
})

test('DNS-rebinding Host is refused even when Origin matches', async () => {
  const { routes } = harness()
  const result = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: {
      'content-type': 'application/json',
      origin: 'http://evil.example:3080',
      host: 'evil.example:3080',
    },
    body: { patch: { showSidebarQuota: true } },
  })
  assert.equal(result.status, 403)
})

test('read routes refuse DNS-rebinding hosts and state is GET-only', async () => {
  const { routes } = harness()
  for (const path of ['state', 'health', 'analytics']) {
    const result = await call(routes.get(`/dsh-opencode/${path}`)!, {
      path: `/dsh-opencode/${path}`,
      headers: {
        host: 'evil.example:3080',
        origin: 'http://evil.example:3080',
      },
    })
    assert.equal(result.status, 403)
  }
  const noOrigin = await call(routes.get('/dsh-opencode/state')!, {
    path: '/dsh-opencode/state',
    headers: { host: 'evil.example:3080' },
  })
  assert.equal(noOrigin.status, 403)
  const postState = await call(routes.get('/dsh-opencode/state')!, {
    method: 'POST',
    path: '/dsh-opencode/state',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    body: {},
  })
  assert.equal(postState.status, 405)
})

test('cross-origin POST is refused', async () => {
  const { routes } = harness()
  const result = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: { patch: {} },
  })
  assert.equal(result.status, 403)
})

test('test route streams a minimal request', async () => {
  const { routes } = harness()
  const result = await call(routes.get('/dsh-opencode/test')!, {
    method: 'POST',
    path: '/dsh-opencode/test',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: { model: 'deepseek-v4.1-flash' },
  })
  assert.equal(result.status, 200)
  const body = result.body as Record<string, unknown>
  assert.equal(body.ok, true)
  assert.equal(body.text, 'OK')
  assert.equal(typeof body.latencyMs, 'number')
})

test('non-local Host writes are refused even from a LAN socket', async () => {
  const { routes } = harness()
  const result = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: {
      host: 'evil.example:3080',
      'content-type': 'application/json',
      origin: 'http://evil.example:3080',
    },
    body: { patch: {} },
    remoteAddress: '10.0.0.5',
  })
  assert.equal(result.status, 403)
})

test('trusted local interface Host serves Web reads and writes', async () => {
  const ip = localIpv4()
  if (ip === undefined) return
  const { routes } = harness()
  const authority = `${ip}:3080`
  const state = await call(routes.get('/dsh-opencode/state')!, {
    path: '/dsh-opencode/state',
    headers: { host: authority, origin: `http://${authority}` },
    remoteAddress: '10.0.0.5',
  })
  assert.equal(state.status, 200)
  const config = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: {
      host: authority,
      'content-type': 'application/json',
      origin: `http://${authority}`,
      'sec-fetch-site': 'same-origin',
    },
    body: { patch: { showSidebarQuota: true } },
    remoteAddress: '10.0.0.5',
  })
  assert.equal(config.status, 200)
})

test('health route reports provider registration', async () => {
  const { routes } = harness()
  const result = await call(routes.get('/dsh-opencode/health')!, { path: '/dsh-opencode/health' })
  assert.equal(result.status, 200)
  const body = result.body as Record<string, unknown>
  assert.equal(body.ok, true)
  assert.deepEqual(body.providers, [CONSOLE_PROVIDER, GO_PROVIDER])
  assert.equal(body.accounts, 1)
  assert.equal(body.models, 1)
})

test('analytics route reports a heatmap failure', async () => {
  const { routes } = harness({ heatmapError: true })
  const result = await call(routes.get('/dsh-opencode/analytics')!, { path: '/dsh-opencode/analytics?days=7' })
  assert.equal(result.status, 500)
  assert.deepEqual(result.body, { error: 'heatmap failed' })
})

test('analytics route returns aggregated model rows', async () => {
  const { routes } = harness()
  const result = await call(routes.get('/dsh-opencode/analytics')!, {
    method: 'GET',
    path: '/dsh-opencode/analytics?days=7',
  })
  assert.equal(result.status, 200)
  const body = result.body as Record<string, any>
  assert.equal(body.matchedSessions, 1)
  assert.equal(body.models[0].model, 'deepseek-v4.1-flash')
  assert.equal(body.heatmap.total, 2)
})
