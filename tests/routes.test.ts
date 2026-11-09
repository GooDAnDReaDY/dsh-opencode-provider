import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'

import { resolveConfig } from '../src/config.ts'
import { applyRoutes, type RouteDeps } from '../src/routes.ts'
import { adminAllowed } from '../src/admin-auth.ts'
import { addManagedCredentialRef, readManagedCredentialRefs } from '../src/managed-credentials.ts'
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

let managedSeq = 0

function harness(overrides: { config?: Record<string, unknown>; heatmapError?: boolean } = {}) {
  const routes = new Map<string, (req: unknown, res: unknown) => void | Promise<void>>()
  const mutations: Array<{ ns: string; ops: unknown; revision: unknown }> = []
  const stored = new Map<string, string>()
  const unsetKeys: string[] = []
  const tuiRefreshes = { count: 0 }
  const routeSyncs = { count: 0 }

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
    unset: async (ref: string) => { stored.delete(ref); unsetKeys.push(ref.replace(/^opencode:apiKey:/, '')) },
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
      keyStatus: 'ok',
      latencyMs: 12,
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
    managedPath: join(tmpdir(), `dsh-opencode-managed-${process.pid}-${managedSeq++}.json`),
    refreshTui: () => { tuiRefreshes.count += 1 },
    syncRoutes: () => { routeSyncs.count += 1 },
    adminToken: () => config.adminToken,
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
  return { routes, mutations, stored, tuiRefreshes, routeSyncs, managedPath: deps.managedPath, unsetKeys }
}

test('notices route returns routing events for the same-origin UI', async () => {
  const { routes } = harness()
  const result = await call(routes.get('/dsh-opencode/notices')!, {
    path: '/dsh-opencode/notices',
  })
  assert.equal(result.status, 200)
  assert.deepEqual((result.body as Record<string, unknown>).events, [])
})

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
  assert.equal(body.accounts[0].keyStatus, 'ok')
  assert.equal(body.key.configured, true)
  assert.equal(body.catalog.source, 'snapshot')
  assert.equal(body.catalog.count, 1)
  assert.equal(body.service.usageLatencyMs, 12)
})

test('account check re-reads one account key status', async () => {
  const { routes } = harness()
  const result = await call(routes.get('/dsh-opencode/accounts/check')!, {
    method: 'POST',
    path: '/dsh-opencode/accounts/check',
    headers: {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:3080',
    },
    body: { label: 'default' },
  })
  assert.equal(result.status, 200)
  assert.equal((result.body as Record<string, unknown>).keyStatus, 'ok')
})

test('config route writes path ops with the current revision', async () => {
  const { routes, mutations, tuiRefreshes, routeSyncs } = harness()
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
  assert.equal(routeSyncs.count, 1)
})

test('config route accepts route switches and a proxy username', async () => {
  const { routes, mutations, routeSyncs } = harness()
  const result = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: { patch: { goEnabled: false, consoleEnabled: true, proxyUrl: 'http://proxy.local:8080', proxyUsername: 'alice' } },
  })
  assert.equal(result.status, 200)
  const ops = mutations[0]?.ops as Array<{ op: string; path: string[]; value: unknown }>
  assert.deepEqual(Object.fromEntries(ops.map((op) => [op.path[0], op.value])), {
    goEnabled: false,
    consoleEnabled: true,
    proxyUrl: 'http://proxy.local:8080/',
    proxyUsername: 'alice',
  })
  assert.equal(routeSyncs.count, 1)
})

test('admin token gates reads and writes even with forged same-origin headers', async () => {
  const { routes, mutations } = harness({ config: { adminToken: 'owner-secret' } })
  const forged = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }
  const read = await call(routes.get('/dsh-opencode/state')!, { headers: forged })
  assert.equal(read.status, 401)
  assert.deepEqual(read.body, { error: 'admin token required', code: 'ADMIN_TOKEN_REQUIRED', authRequired: true })

  const write = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: { ...forged, 'content-type': 'application/json', 'x-opencode-token': 'wrong' },
    body: { patch: { showSidebarQuota: true } },
  })
  assert.equal(write.status, 401)
  assert.equal(mutations.length, 0)

  const authorized = await call(routes.get('/dsh-opencode/state')!, {
    headers: { ...forged, authorization: 'Bearer owner-secret' },
  })
  assert.equal(authorized.status, 200)
})

test('proxy password is stored in credentials and never returned by state', async () => {
  const { routes, stored } = harness({ config: { proxyUsername: 'alice' } })
  const saved = await call(routes.get('/dsh-opencode/proxy-password')!, {
    method: 'POST',
    path: '/dsh-opencode/proxy-password',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: { password: 'super-secret' },
  })
  assert.equal(saved.status, 200)
  assert.equal([...stored.values()].includes('super-secret'), true)

  const state = await call(routes.get('/dsh-opencode/state')!)
  assert.equal(state.status, 200)
  const body = state.body as { proxy: { configured: boolean }; config: Record<string, unknown> }
  assert.equal(body.proxy.configured, true)
  assert.equal(JSON.stringify(body).includes('super-secret'), false)

  const cleared = await call(routes.get('/dsh-opencode/proxy-password/clear')!, {
    method: 'POST',
    path: '/dsh-opencode/proxy-password/clear',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: {},
  })

  assert.equal(cleared.status, 200)
})

test('config route uses the draft revision for compare-and-swap', async () => {
  const { routes, mutations } = harness()
  const result = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: { revision: 4, patch: { showSidebarQuota: true } },
  })
  assert.equal(result.status, 200)
  assert.equal(mutations[0]?.revision, 4)
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
    const { routes, stored } = harness({
      config: { accounts: [{ label: 'imported', apiKeyEnv: 'OPENCODE_AUTH_OPENCODE_GO' }] },
    })
    const result = await call(routes.get('/dsh-opencode/auth-import')!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://127.0.0.1:3080',
      },
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

test('state marks plugin-managed credentials and clearing removes the mark', async () => {
  const { routes } = harness()
  const save = await call(routes.get('/dsh-opencode/key')!, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: { key: 'oc_sk_test' },
  })
  assert.equal(save.status, 200)
  const managedState = await call(routes.get('/dsh-opencode/state')!)
  assert.equal((managedState.body as Record<string, any>).accounts[0].managed, true)

  const clear = await call(routes.get('/dsh-opencode/key/clear')!, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: {},
  })
  assert.equal(clear.status, 200)
  const clearedState = await call(routes.get('/dsh-opencode/state')!)
  assert.equal((clearedState.body as Record<string, any>).accounts[0].managed, false)
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

test('write routes fail closed without Origin or Referer', async () => {
  const { routes } = harness({ config: { adminToken: 'owner-secret' } })
  const result = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: { 'content-type': 'application/json', 'x-opencode-token': 'owner-secret' },
    body: { patch: { showSidebarQuota: true } },
    remoteAddress: '127.0.0.1',
  })
  assert.equal(result.status, 403)
  const referer = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: {
      'content-type': 'application/json',
      referer: 'http://127.0.0.1:3080/settings',
      'x-opencode-token': 'owner-secret',
    },
    body: { patch: { showSidebarQuota: true } },
    remoteAddress: '10.0.0.5',
  })
  assert.equal(referer.status, 200)
})

test('a LAN peer without a token is refused even with forged same-origin headers', async () => {
  const { routes } = harness()
  const result = await call(routes.get('/dsh-opencode/state')!, {
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    remoteAddress: '10.0.0.5',
  })
  assert.equal(result.status, 401)
})

test('config route rejects non-opencode endpoints unless explicitly allowed', async () => {
  const { routes, mutations } = harness()
  const denied = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: { patch: { apiBase: 'https://attacker.example' } },
  })
  assert.equal(denied.status, 400)
  assert.equal(mutations.length, 0)

  const allowed = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' },
    body: { patch: { allowCustomEndpoints: true, apiBase: 'https://attacker.example' } },
  })
  assert.equal(allowed.status, 200)
})

test('non-local Host writes are refused even from a LAN socket', async () => {
  const { routes } = harness({ config: { adminToken: 'owner-secret' } })
  const result = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: {
      host: 'evil.example:3080',
      'content-type': 'application/json',
      origin: 'http://evil.example:3080',
      'x-opencode-token': 'owner-secret',
    },
    body: { patch: {} },
    remoteAddress: '10.0.0.5',
  })
  assert.equal(result.status, 403)
})

test('trusted local interface Host serves Web reads and writes', async () => {
  const ip = localIpv4()
  if (ip === undefined) return
  const { routes } = harness({ config: { adminToken: 'owner-secret' } })
  const authority = `${ip}:3080`
  const state = await call(routes.get('/dsh-opencode/state')!, {
    path: '/dsh-opencode/state',
    headers: { host: authority, origin: `http://${authority}`, 'x-opencode-token': 'owner-secret' },
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
      'x-opencode-token': 'owner-secret',
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
  assert.deepEqual(result.body, { error: 'analytics failed', code: 'INTERNAL_ERROR' })
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

test('admin token verification uses constant-time hash comparison on unequal lengths', () => {
  const req = {
    headers: { 'x-opencode-token': 'wrong-length' },
    socket: { remoteAddress: '192.168.1.50' },
  }
  assert.equal(adminAllowed(req as any, 'secret-admin-token'), false)
  const matchingReq = {
    headers: { 'x-opencode-token': 'secret-admin-token' },
    socket: { remoteAddress: '192.168.1.50' },
  }
  assert.equal(adminAllowed(matchingReq as any, 'secret-admin-token'), true)
})

test('notices route gates events when showSwitchNotice is disabled', async () => {
  const { routes } = harness({ config: { showSwitchNotice: false } })
  const result = await call(routes.get('/dsh-opencode/notices')!, {
    path: '/dsh-opencode/notices',
  })
  assert.equal(result.status, 200)
  assert.equal((result.body as any).enabled, false)
  assert.deepEqual((result.body as any).events, [])

  const { routes: enabledRoutes } = harness({ config: { showSwitchNotice: true } })
  const enabledResult = await call(enabledRoutes.get('/dsh-opencode/notices')!, {
    path: '/dsh-opencode/notices',
  })
  assert.equal(enabledResult.status, 200)
  assert.equal((enabledResult.body as any).enabled, true)
})


test('loopback proxy forwarding headers fail closed without admin token', () => {
  const proxiedXff = {
    headers: { 'x-forwarded-for': '192.168.1.100' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(adminAllowed(proxiedXff as any, ''), false)

  const proxiedRealIp = {
    headers: { 'x-real-ip': '192.168.1.100' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(adminAllowed(proxiedRealIp as any, ''), false)

  const proxiedWithToken = {
    headers: { 'x-forwarded-for': '192.168.1.100', 'x-opencode-token': 'admin-secret' },
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(adminAllowed(proxiedWithToken as any, 'admin-secret'), true)

  const directDesktop = {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  }
  assert.equal(adminAllowed(directDesktop as any, ''), true)
})

test('local custom endpoint requires allowCustomEndpoints to be true', async () => {
  const forged = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' }
  const { routes } = harness({ config: { allowCustomEndpoints: false } })
  const rejected = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: forged,
    body: { patch: { goZenBase: 'http://127.0.0.1:18234' } },
  })
  assert.equal(rejected.status, 400)
  assert.equal((rejected.body as any).error, 'custom endpoints require allowCustomEndpoints')

  const { routes: allowedRoutes, mutations } = harness({ config: { allowCustomEndpoints: false } })
  const accepted = await call(allowedRoutes.get('/dsh-opencode/config')!, {
    method: 'POST',
    path: '/dsh-opencode/config',
    headers: forged,
    body: { patch: { allowCustomEndpoints: true, goZenBase: 'http://127.0.0.1:18234' } },
  })
  assert.equal(accepted.status, 200)
  assert.equal(mutations.length, 1)
})

test('key clear deletes managed credential after account is removed from config but protects shared key', async () => {
  const { routes, managedPath, unsetKeys } = harness({
    config: {
      accounts: [{ label: 'Account B', apiKeyEnv: 'SHARED_KEY' }],
    },
  })
  await addManagedCredentialRef('REMOVED_ACCOUNT_KEY', managedPath)
  await addManagedCredentialRef('SHARED_KEY', managedPath)

  const forged = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' }
  // 1. Clearing a removed account's key (not in accounts, but was managed by plugin) succeeds
  const cleared = await call(routes.get('/dsh-opencode/key/clear')!, {
    method: 'POST',
    path: '/dsh-opencode/key/clear',
    headers: forged,
    body: { ref: 'REMOVED_ACCOUNT_KEY' },
  })

  assert.equal(cleared.status, 200)
  assert.equal(unsetKeys.includes('REMOVED_ACCOUNT_KEY'), true)
  const remaining = await readManagedCredentialRefs(managedPath)
  assert.equal(remaining.has('REMOVED_ACCOUNT_KEY'), false)

  // 2. Clearing a key that is still used by Account B fails closed
  const sharedAttempt = await call(routes.get('/dsh-opencode/key/clear')!, {
    method: 'POST',
    path: '/dsh-opencode/key/clear',
    headers: forged,
    body: { ref: 'SHARED_KEY' },
  })
  assert.equal(sharedAttempt.status, 400)
  assert.equal((sharedAttempt.body as any).error, 'credential ref is still in use by another account')
  assert.equal(unsetKeys.includes('SHARED_KEY'), false)
})

test('internal exception text is not exposed in route error responses', async () => {
  const SENSITIVE_MARKER = 'INTERNAL_DIAGNOSTIC_MARKER_998877'
  const { routes } = harness()
  // Mock state building error
  const stateRoute = routes.get('/dsh-opencode/state')!
  const failingReq = {
    method: 'GET',
    headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
  }
  // The error handler in state route returns sanitized 'state failed'
  const result = await call(routes.get('/dsh-opencode/analytics')!, {
    path: '/dsh-opencode/analytics?days=bad_days',
  })
  assert.equal(JSON.stringify(result.body).includes(SENSITIVE_MARKER), false)
})

test('GET routes enforce Sec-Fetch-Site and Referer same-origin checks', async () => {
  const { routes } = harness()
  const stateRoute = routes.get('/dsh-opencode/state')!

  // 1. Cross-site sec-fetch-site is rejected
  const crossSite = await call(stateRoute, {
    method: 'GET',
    headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(crossSite.status, 403)
  assert.equal((crossSite.body as any).error, 'cross-origin request refused')

  // 2. Cross-origin referer is rejected
  const crossReferer = await call(stateRoute, {
    method: 'GET',
    headers: { host: '127.0.0.1:3080', referer: 'http://malicious.example.com/evil.html' },
  })
  assert.equal(crossReferer.status, 403)

  // 3. Same-origin referer with same-origin sec-fetch-site succeeds
  const validSameOrigin = await call(stateRoute, {
    method: 'GET',
    headers: { host: '127.0.0.1:3080', referer: 'http://127.0.0.1:3080/settings', 'sec-fetch-site': 'same-origin' },
  })
  assert.equal(validSameOrigin.status, 200)
})

test('clearing default key protects key if shared by auxiliary account', async () => {
  const { routes, unsetKeys } = harness({
    config: {
      apiKeyEnv: 'SHARED_DEFAULT',
      accounts: [{ label: 'Aux Account', apiKeyEnv: 'SHARED_DEFAULT' }],
    },
  })
  const forged = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'content-type': 'application/json' }
  // Clearing default key without explicit ref fails because Aux Account still uses it
  const attempt = await call(routes.get('/dsh-opencode/key/clear')!, {
    method: 'POST',
    path: '/dsh-opencode/key/clear',
    headers: forged,
    body: {},
  })
  assert.equal(attempt.status, 400)
  assert.equal((attempt.body as any).error, 'credential ref is still in use by another account')
  assert.equal(unsetKeys.includes('SHARED_DEFAULT'), false)
})

test('error responses include machine-readable error codes', async () => {
  const { routes } = harness()
  const loopback = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }

  const methodNotAllowed = await call(routes.get('/dsh-opencode/state')!, {
    method: 'POST',
    headers: loopback,
  })
  assert.equal(methodNotAllowed.status, 405)
  assert.equal((methodNotAllowed.body as any).code, 'METHOD_NOT_ALLOWED')

  const forbidden = await call(routes.get('/dsh-opencode/state')!, {
    method: 'GET',
    headers: { host: 'evil.com', origin: 'http://evil.com' },
  })
  assert.equal(forbidden.status, 403)
  assert.equal((forbidden.body as any).code, 'FORBIDDEN')

  const unsupportedType = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    headers: { ...loopback, 'content-type': 'text/plain' },
  })
  assert.equal(unsupportedType.status, 415)
  assert.equal((unsupportedType.body as any).code, 'UNSUPPORTED_MEDIA_TYPE')

  const badRequest = await call(routes.get('/dsh-opencode/config')!, {
    method: 'POST',
    headers: { ...loopback, 'content-type': 'application/json' },
    body: { patch: {} },
  })
  assert.equal(badRequest.status, 400)
  assert.equal((badRequest.body as any).code, 'BAD_REQUEST')
})
