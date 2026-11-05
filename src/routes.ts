import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'

import type { OpenCodeAdapter } from './adapter.ts'
import { effectiveModel, modelVisible, clearCatalogCache, catalogStatus } from './catalog.ts'
import { readModelAnalytics, type AnalyticsReport } from './analytics.ts'
import { authorityHostname, isLocalHostname, sameOrigin } from './local-host.ts'
import { NS, type Config, type ResolvedConfig } from './config.ts'
import { addManagedCredentialRef, readManagedCredentialRefs, removeManagedCredentialRef } from './managed-credentials.ts'
import { CONSOLE_PROVIDER, GO_PROVIDER } from './provider-ids.ts'
import { normalizeProxyUrl } from './proxy.ts'
import { publicConfig } from './routes-public.ts'
import { cleanAccounts, cleanBooleanRecord, cleanModelAccountRules, cleanNonNegativeNumberRecord, cleanNumberRecord, cleanStringArray, cleanTransports } from './routes-values.ts'
import { readOpenCodeAuthKey, listOpenCodeAuthEntries, type KeyPool } from './credentials.ts'
import type { RequestHeatmap } from './request-log.ts'
import { limitsFor } from './subscription-limits.ts'
import type { UsageKeyStatus, UsageReader } from './usage.ts'

const MAX_BODY_BYTES = 256 * 1024

export interface RouteDeps {
  readonly config: () => ResolvedConfig
  readonly adapter: OpenCodeAdapter
  readonly pool: KeyPool
  readonly usage: UsageReader
  readonly analytics?: (days: number) => Promise<AnalyticsReport>
  readonly heatmap?: (days: number) => Promise<RequestHeatmap>
  readonly refreshTui?: () => void
  /** Test seam; defaults to the local managed-credentials registry. */
  readonly managedPath?: string
}

type UsageValue = Awaited<ReturnType<UsageReader>> | null

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

function allowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined || origin === '') return true
  const host = req.headers.host
  return host !== undefined && sameOrigin(host, origin)
}

/**
 * DNS rebinding keeps the browser's `Host` pointing at the attacker's name
 * while the socket reaches loopback. A trusted Host must therefore be either
 * loopback or one of this machine's literal interface addresses; a hostname
 * cannot pass on same-origin checks alone.
 */
function trustedHost(req: IncomingMessage): boolean {
  const hostname = authorityHostname(req.headers.host)
  return hostname !== undefined && isLocalHostname(hostname)
}

function writeOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host
  const source = req.headers.origin ?? req.headers.referer
  if (host === undefined || source === undefined || source === '') return false
  return sameOrigin(host, source)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('payload too large')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function requirePost(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'POST') {
    json(res, 405, { error: 'POST required' })
    return false
  }
  if (!trustedHost(req)) {
    json(res, 403, { error: 'non-local Host refused' })
    return false
  }
  if (!writeOrigin(req)) {
    json(res, 403, { error: 'same-origin Origin or Referer required' })
    return false
  }
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    json(res, 403, { error: 'cross-site request refused' })
    return false
  }
  const type = req.headers['content-type'] ?? ''
  if (!type.includes('application/json')) {
    json(res, 415, { error: 'application/json required' })
    return false
  }
  return true
}

function getSettings(ctx: Context): { describe?: (options?: { redactSecrets?: boolean }) => Array<{ ns: string; revision?: number }>; mutate?: (ns: string, ops: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>, revision?: number) => Promise<void>; writable?: boolean } | undefined {
  return ctx.get('settings') as never
}

function getCredentials(ctx: Context): CredentialProvider | undefined {
  return ctx.get('credentials') as CredentialProvider | undefined
}

function settingsRevision(ctx: Context): number | undefined {
  const settings = getSettings(ctx)
  try {
    return settings?.describe?.({ redactSecrets: true }).find((row) => row.ns === NS)?.revision
  } catch {
    return undefined
  }
}

function configOps(patch: Record<string, unknown>): Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }> {
  const ops: Array<{ op: 'set' | 'unset'; path: string[]; value?: unknown }> = []
  const set = (field: keyof Config, value: unknown): void => {
    if (value === null || value === undefined) ops.push({ op: 'unset', path: [field] })
    else ops.push({ op: 'set', path: [field], value })
  }
  if ('apiKeyEnv' in patch) set('apiKeyEnv', patch.apiKeyEnv)
  if ('apiBase' in patch) set('apiBase', patch.apiBase)
  if ('goApiBase' in patch) set('goApiBase', patch.goApiBase)
  if ('goZenBase' in patch) set('goZenBase', patch.goZenBase)
  if ('usageUrl' in patch) set('usageUrl', patch.usageUrl)
  if ('openCodeAuthEntry' in patch) set('openCodeAuthEntry', patch.openCodeAuthEntry)
  if ('requestTimeoutMs' in patch) set('requestTimeoutMs', patch.requestTimeoutMs)
  if ('streamIdleTimeoutMs' in patch) set('streamIdleTimeoutMs', patch.streamIdleTimeoutMs)
  if ('proxyUrl' in patch) set('proxyUrl', normalizeProxyUrl(typeof patch.proxyUrl === 'string' ? patch.proxyUrl : ''))
  if ('visibleModels' in patch) set('visibleModels', cleanStringArray(patch.visibleModels))
  if ('modelVisibility' in patch) set('modelVisibility', cleanBooleanRecord(patch.modelVisibility))
  if ('filterModelsByPlan' in patch) set('filterModelsByPlan', patch.filterModelsByPlan === true)
  if ('modelTransports' in patch) set('modelTransports', cleanTransports(patch.modelTransports))
  if ('contextWindow' in patch) set('contextWindow', patch.contextWindow)
  if ('contextWindowOverrides' in patch) set('contextWindowOverrides', cleanNumberRecord(patch.contextWindowOverrides))
  if ('maxOutputTokens' in patch) set('maxOutputTokens', patch.maxOutputTokens)
  if ('maxOutputTokensOverrides' in patch) set('maxOutputTokensOverrides', cleanNonNegativeNumberRecord(patch.maxOutputTokensOverrides))
  if ('accounts' in patch) set('accounts', cleanAccounts(patch.accounts))
  if ('modelAccountRules' in patch) set('modelAccountRules', cleanModelAccountRules(patch.modelAccountRules))
  if ('quotaFallbackModel' in patch) set('quotaFallbackModel', patch.quotaFallbackModel)
  if ('autoSwitch' in patch) set('autoSwitch', patch.autoSwitch === true)
  if ('stickySession' in patch) set('stickySession', patch.stickySession === true)
  if ('activeAccount' in patch) set('activeAccount', patch.activeAccount)
  if ('usageDisplay' in patch) {
    const value = patch.usageDisplay
    if (value === 'auto' || value === 'always' || value === 'off') set('usageDisplay', value)
  }
  if ('showSidebarQuota' in patch) set('showSidebarQuota', patch.showSidebarQuota === true)
  if ('userAgent' in patch) set('userAgent', patch.userAgent)
  return ops
}

async function buildState(ctx: Context, deps: RouteDeps): Promise<Record<string, unknown>> {
  const config = deps.config()
  const credentials = getCredentials(ctx)
  let keyInfo: { configured: boolean; writable: boolean; source?: string } = {
    configured: false,
    writable: false,
  }
  if (credentials !== undefined) {
    try {
      const info = await credentials.describe(credentialRef(config.apiKeyEnv))
      keyInfo = {
        configured: info.configured,
        writable: info.writable,
        ...(info.source === undefined ? {} : { source: info.source }),
      }
    } catch {
      // An invalid reference is reported as unconfigured.
    }
  }

  const resolved = await deps.pool.resolveAll(GO_PROVIDER).catch(() => [])
  if (!keyInfo.configured) {
    keyInfo = { ...keyInfo, configured: resolved.length > 0 }
  }

  // One usage read per distinct key: labels may share a credential.
  const usageByKey = new Map<string, UsageValue>()
  await Promise.all([...new Set(resolved.map((entry) => entry.key))].map(async (key) => {
    const result = await deps.usage(GO_PROVIDER, key)
    usageByKey.set(key, result ?? null)
  }))
  const usageByLabel = new Map<string, UsageValue>()
  for (const entry of resolved) {
    usageByLabel.set(entry.label ?? 'default', usageByKey.get(entry.key) ?? null)
  }

  const managedRefs = await readManagedCredentialRefs(deps.managedPath)
  const slots = [
    { label: 'default', ref: config.apiKeyEnv, default: true },
    ...config.accounts.map((account, index) => ({
      label: typeof account.label === 'string' && account.label.trim() !== ''
        ? account.label.trim()
        : `account-${index + 2}`,
      ref: typeof account.apiKeyEnv === 'string' ? account.apiKeyEnv.trim() : '',
      default: false,
    })),
  ]
  let activeLabel = ''
  for (const entry of resolved) {
    if (deps.adapter.accountHealth(entry.key) === undefined) {
      activeLabel = entry.label ?? 'default'
      break
    }
  }
  const keyByLabel = new Map(resolved.map((entry) => [entry.label ?? 'default', entry]))
  const accounts: Array<{
    label: string
    ref: string
    default: boolean
    configured: boolean
    source: string
    active: boolean
    coolingUntil: number
    mark: string
    keyStatus: UsageKeyStatus | 'unchecked'
    usage: UsageValue
    managed: boolean
  }> = []
  for (const slot of slots) {
    let configured = false
    let source = ''
    if (slot.ref !== '' && credentials !== undefined) {
      try {
        const info = await credentials.describe(credentialRef(slot.ref))
        configured = info.configured
        source = info.source ?? ''
      } catch {
        // An invalid reference is reported as unconfigured.
      }
    }
    const hit = keyByLabel.get(slot.label)
    if (!configured && hit !== undefined) {
      configured = true
      source = hit.source
    }
    const health = hit === undefined ? undefined : deps.adapter.accountHealth(hit.key)
    const usage = hit === undefined ? null : usageByLabel.get(slot.label) ?? null
    const keyStatus: UsageKeyStatus | 'unchecked' = !configured
      ? 'missing'
      : health?.reason === 'invalid-credential'
        ? 'invalid'
        : usage?.keyStatus ?? 'unchecked'
    accounts.push({
      ...slot,
      configured,
      source,
      active: activeLabel === slot.label,
      coolingUntil: health?.coolingUntil ?? 0,
      mark: health?.reason ?? '',
      keyStatus,
      usage,
      managed: slot.ref !== '' && managedRefs.has(slot.ref),
    })
  }

  let models: Array<Record<string, unknown>> = []
  try {
    const listed = await deps.adapter.listModels(GO_PROVIDER, { unfiltered: true })
    models = listed.map((model) => {
      const meta = effectiveModel(model.id, config)
      return {
        id: model.id,
        name: model.name,
        description: model.description ?? '',
        transport: meta.transport,
        contextWindow: meta.contextWindow,
        maxTokens: meta.maxTokens,
        free: meta.free,
        cost: meta.cost,
        limits: limitsFor(model.id) ?? null,
        input: meta.input,
        reasoning: meta.reasoning,
        visible: modelVisible(model.id, config),
      }
    })
  } catch {
    models = []
  }

  const displayEntry = resolved.find((entry) => (entry.label ?? 'default') === activeLabel) ?? resolved[0]
  const usage = displayEntry === undefined
    ? null
    : usageByLabel.get(displayEntry.label ?? 'default') ?? null
  return {
    config: publicConfig(config),
    key: keyInfo,
    accounts,
    models,
    catalog: catalogStatus(GO_PROVIDER, config, models.length),
    usage: usage ?? null,
    service: {
      ...(usage?.checkedAt === undefined ? {} : { usageCheckedAt: usage.checkedAt }),
      ...(usage?.latencyMs === undefined ? {} : { usageLatencyMs: usage.latencyMs }),
      ...(usage?.error === undefined ? {} : { usageError: usage.error }),
      ...(usage?.stale === true ? { usageStale: true } : {}),
    },
    routing: deps.adapter.routingTrace(),
    auth: {
      entry: config.openCodeAuthEntry,
      hasStoredKey: (await readOpenCodeAuthKey(config.openCodeAuthEntry)) !== undefined,
      entries: await listOpenCodeAuthEntries(),
    },
    revision: settingsRevision(ctx),
  }
}

/** Register the Host HTTP surface consumed by the browser settings page. */
export function applyRoutes(ctx: Context, web: WebServer, deps: RouteDeps): void {
  const disposers: Array<() => void> = []

  const route = (path: string, handler: WebRoute['handler']): void => {
    disposers.push(web.register({ kind: 'exact', path, handler }))
  }

  route('/dsh-opencode/state', async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'GET required' })
      return
    }
    if (!trustedHost(req)) {
      json(res, 403, { error: 'non-local Host refused' })
      return
    }
    if (!allowedOrigin(req)) {
      json(res, 403, { error: 'cross-origin request refused' })
      return
    }
    try {
      json(res, 200, await buildState(ctx, deps))
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'state failed' })
    }
  })

  route('/dsh-opencode/notices', async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'GET required' })
      return
    }
    if (!trustedHost(req)) {
      json(res, 403, { error: 'non-local Host refused' })
      return
    }
    if (!allowedOrigin(req)) {
      json(res, 403, { error: 'cross-origin request refused' })
      return
    }
    json(res, 200, { events: deps.adapter.routingTrace() })
  })

  route('/dsh-opencode/health', async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'GET required' })
      return
    }
    if (!trustedHost(req)) {
      json(res, 403, { error: 'non-local Host refused' })
      return
    }
    if (!allowedOrigin(req)) {
      json(res, 403, { error: 'cross-origin request refused' })
      return
    }
    try {
      const config = deps.config()
      const models = await deps.adapter.listModels(GO_PROVIDER, { unfiltered: true }).catch(() => [])
      json(res, 200, {
        ok: true,
        providers: [CONSOLE_PROVIDER, GO_PROVIDER],
        accounts: config.accounts.length + 1,
        models: models.length,
      })
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'health failed' })
    }
  })

  route('/dsh-opencode/analytics', async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { error: 'GET required' })
      return
    }
    if (!trustedHost(req)) {
      json(res, 403, { error: 'non-local Host refused' })
      return
    }
    if (!allowedOrigin(req)) {
      json(res, 403, { error: 'cross-origin request refused' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const requested = Number(url.searchParams.get('days') ?? '30')
    const days = Number.isFinite(requested) ? Math.max(1, Math.min(365, Math.trunc(requested))) : 30
    try {
      const report = deps.analytics === undefined
        ? await readModelAnalytics(days)
        : await deps.analytics(days)
      const heatmap = deps.heatmap === undefined ? undefined : await deps.heatmap(days)
      json(res, 200, heatmap === undefined ? report : { ...report, heatmap })
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'analytics failed' })
    }
  })

  route('/dsh-opencode/config', async (req, res) => {
    if (!requirePost(req, res)) return
    const settings = getSettings(ctx)
    if (settings?.mutate === undefined) {
      json(res, 503, { error: 'settings service unavailable' })
      return
    }
    if (settings.writable === false) {
      json(res, 403, { error: 'settings are read-only' })
      return
    }
    try {
      const body = await readJson(req)
      const patch = typeof body.patch === 'object' && body.patch !== null && !Array.isArray(body.patch)
        ? body.patch as Record<string, unknown>
        : body
      const ops = configOps(patch)
      if (ops.length === 0) {
        json(res, 400, { error: 'no known fields in patch' })
        return
      }
      const revision = typeof body.revision === 'number' && Number.isInteger(body.revision)
        ? body.revision
        : settingsRevision(ctx)
      await settings.mutate(NS, ops, revision)
      deps.usage.clear()
      deps.refreshTui?.()
      json(res, 200, { ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'config write failed'
      const conflict = /revision|conflict|stale/i.test(message)
      json(res, conflict ? 409 : 500, { error: message })
    }
  })

  route('/dsh-opencode/key', async (req, res) => {
    if (!requirePost(req, res)) return
    const credentials = getCredentials(ctx)
    if (credentials === undefined) {
      json(res, 503, { error: 'credentials service unavailable' })
      return
    }
    try {
      const body = await readJson(req)
      const refName = typeof body.ref === 'string' && body.ref.trim() !== ''
        ? body.ref.trim()
        : deps.config().apiKeyEnv
      const key = typeof body.key === 'string' ? body.key.trim() : ''
      if (key === '') {
        json(res, 400, { error: 'key is required' })
        return
      }
      await credentials.set(credentialRef(refName), key)
      await addManagedCredentialRef(refName, deps.managedPath)
      json(res, 200, { ok: true, ref: refName })
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'key write failed' })
    }
  })

  route('/dsh-opencode/key/clear', async (req, res) => {
    if (!requirePost(req, res)) return
    const credentials = getCredentials(ctx)
    if (credentials === undefined) {
      json(res, 503, { error: 'credentials service unavailable' })
      return
    }
    try {
      const body = await readJson(req)
      const refName = typeof body.ref === 'string' && body.ref.trim() !== ''
        ? body.ref.trim()
        : deps.config().apiKeyEnv
      await credentials.unset(credentialRef(refName))
      await removeManagedCredentialRef(refName, deps.managedPath)
      json(res, 200, { ok: true, ref: refName })
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'key clear failed' })
    }
  })

  route('/dsh-opencode/auth-import', async (req, res) => {
    if (!requirePost(req, res)) return
    const credentials = getCredentials(ctx)
    if (credentials === undefined) {
      json(res, 503, { error: 'credentials service unavailable' })
      return
    }
    try {
      const body = await readJson(req)
      const entry = typeof body.entry === 'string' && body.entry.trim() !== ''
        ? body.entry.trim()
        : deps.config().openCodeAuthEntry
      const ref = typeof body.ref === 'string' && body.ref.trim() !== ''
        ? body.ref.trim()
        : deps.config().apiKeyEnv
      const key = await readOpenCodeAuthKey(entry)
      if (key === undefined) {
        json(res, 404, { error: `no key in auth.json entry "${entry}"` })
        return
      }
      await credentials.set(credentialRef(ref), key)
      await addManagedCredentialRef(ref, deps.managedPath)
      json(res, 200, { ok: true, entry, ref })
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'import failed' })
    }
  })

  route('/dsh-opencode/refresh', async (req, res) => {
    if (!requirePost(req, res)) return
    deps.usage.clear()
    try {
      json(res, 200, await buildState(ctx, deps))
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'refresh failed' })
    }
  })

  route('/dsh-opencode/accounts/check', async (req, res) => {
    if (!requirePost(req, res)) return
    try {
      const body = await readJson(req)
      const label = typeof body.label === 'string' && body.label.trim() !== ''
        ? body.label.trim()
        : 'default'
      const entries = await deps.pool.resolveAll(GO_PROVIDER).catch(() => [])
      const hit = entries.find((entry) => (entry.label ?? 'default') === label)
      if (hit === undefined) {
        json(res, 404, { error: `account "${label}" is not configured` })
        return
      }
      deps.usage.clear()
      const result = await deps.usage(GO_PROVIDER, hit.key)
      const keyStatus = result?.keyStatus ?? 'unchecked'
      json(res, 200, {
        ok: keyStatus === 'ok',
        keyStatus,
        ...(result?.error === undefined ? {} : { error: result.error }),
      })
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'account check failed' })
    }
  })

  route('/dsh-opencode/models/refresh', async (req, res) => {
    if (!requirePost(req, res)) return
    clearCatalogCache()
    try {
      json(res, 200, await buildState(ctx, deps))
    } catch (error) {
      json(res, 500, { error: error instanceof Error ? error.message : 'catalog refresh failed' })
    }
  })

  route('/dsh-opencode/test', async (req, res) => {
    if (!requirePost(req, res)) return
    let body: Record<string, unknown>
    try {
      body = await readJson(req)
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : 'invalid body' })
      return
    }
    const model = typeof body.model === 'string' && body.model !== '' ? body.model : 'deepseek-v4.1-flash'
    const provider = body.provider === CONSOLE_PROVIDER ? CONSOLE_PROVIDER : GO_PROVIDER
    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    let text = ''
    let finish: unknown
    try {
      const options: GenerateOptions = {
        provider,
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] }],
        maxTokens: 16,
        signal: controller.signal,
      }
      for await (const chunk of deps.adapter.stream(options)) {
        if (chunk.type === 'text-delta') text += chunk.text
        else if (chunk.type === 'finish') finish = chunk.reason
      }
      json(res, 200, {
        ok: true,
        model,
        provider,
        latencyMs: Date.now() - started,
        text: text.slice(0, 200),
        finish,
      })
    } catch (error) {
      json(res, 200, {
        ok: false,
        model,
        provider,
        latencyMs: Date.now() - started,
        error: controller.signal.aborted
          ? 'timeout'
          : error instanceof Error ? error.message : 'test failed',
      })
    } finally {
      clearTimeout(timer)
    }
  })

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-opencode-provider: HTTP routes')
}
