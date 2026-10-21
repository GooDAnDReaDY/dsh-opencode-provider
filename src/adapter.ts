import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  attributionHeaders,
  resolveRetryPolicy,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type ResolvedRetryPolicy,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

import {
  describeModel,
  discoverModelIds,
  effectiveMaxTokens,
  effectiveModel,
  sortForPicker,
  type EffectiveModel,
} from './catalog.ts'
import { matchModelAccount, orderKeysForModel } from './account-rules.ts'
import type { ResolvedConfig } from './config.ts'
import type { KeyResolver, ResolvedKey } from './credentials.ts'
import { classifyResponseError } from './errors.ts'
import { hasImages, resolveImages, type ImageMap } from './images.ts'
import { buildChatBody } from './messages.ts'
import { CONSOLE_PROVIDER, GO_PROVIDER } from './provider-ids.ts'
import { endpointFor, isGoProvider } from './routing.ts'
import { recordRequest as defaultRecordRequest, type RequestOutcome } from './request-log.ts'
import { openCodeSessionId } from './session-id.ts'
import { limitTools, MAX_TOOLS } from './tools.ts'
import { buildAnthropicBody, parseAnthropicStream } from './transports/anthropic.ts'
import { buildGoogleBody, parseGoogleStream } from './transports/google.ts'
import { parseChatStream } from './transports/openai-chat.ts'
import { buildResponsesBody, parseResponsesStream } from './transports/responses.ts'

export type RoutingReason = 'rule' | 'sticky' | 'pinned' | 'default' | 'rotation' | 'quota-fallback'

export interface RoutingTraceEntry {
  readonly at: number
  readonly provider: string
  readonly model: string
  readonly account: string
  readonly reason: RoutingReason
  readonly fallback: boolean
  readonly ok: boolean
  readonly error?: string
}

export interface OpenCodeAdapterDeps {
  readonly config: () => ResolvedConfig
  readonly resolveKey: KeyResolver
  readonly resolveKeys?: (provider: string) => Promise<readonly ResolvedKey[]>
  readonly resolveAttachments?: () => AttachmentStore | undefined
  readonly fetchImpl?: typeof fetch
  /** Test seam; defaults to the local append-only request log. */
  readonly recordRequest?: (
    provider: string,
    model: string,
    purpose?: string,
    account?: string,
    reason?: string,
    outcome?: RequestOutcome,
  ) => void
  /** Test seam; defaults to ~/.dsh/storages/dsh-opencode/cooldowns.json. */
  readonly cooldownPath?: string
  /** Test seam; defaults to ~/.dsh/storages/dsh-opencode/sticky.json. */
  readonly stickyPath?: string
  /** Receives a one-time warning when the provider tool limit drops tools. */
  readonly warn?: (message: string) => void
}

function defaultCooldownPath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-opencode', 'cooldowns.json')
}

function defaultStickyPath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-opencode', 'sticky.json')
}

export class OpenCodeAdapter extends LlmAdapter {
  private readonly fetchImpl: typeof fetch
  private readonly cooldownPath: string
  private readonly stickyPath: string
  private cooldownWrites: Promise<void> = Promise.resolve()
  private stickyWrites: Promise<void> = Promise.resolve()
  /** key fingerprint → cooldown deadline and the rejection that caused it. */
  private readonly cooldowns = new Map<string, { until: number; reason: string }>()
  private readonly sticky = new Map<string, {
    fingerprint: string
    label: string
    provider: string
    model: string
    at: number
  }>()
  private readonly routing: RoutingTraceEntry[] = []
  private warnedTools = false

  constructor(private readonly deps: OpenCodeAdapterDeps) {
    super()
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.cooldownPath = deps.cooldownPath ?? defaultCooldownPath()
    this.stickyPath = deps.stickyPath ?? defaultStickyPath()
    this.loadCooldowns()
    this.loadSticky()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return {
      id: provider,
      name: isGoProvider(provider) ? 'OpenCode Go (plugin)' : 'OpenCode (plugin)',
    }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return resolveRetryPolicy(
      {
        mode: 'normal',
        maxRetries: 5,
        retryableCodes: ['EMPTY_RESPONSE', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT'],
        backoff: { initialDelayMs: 500, maxDelayMs: 15_000, jitterRatio: 0.1 },
      },
      'llm-opencode: retryPolicy',
    )
  }

  override async listModels(
    provider: string,
    opts?: { unfiltered?: boolean },
  ): Promise<readonly LlmModelInfo[]> {
    const config = this.deps.config()
    let apiKey: string | undefined
    try {
      apiKey = (await this.deps.resolveKey(provider)).key
    } catch {
      apiKey = undefined
    }
    const ids = await discoverModelIds(provider, config, apiKey, this.fetchImpl)
    return sortForPicker(ids, config, opts?.unfiltered === true, provider).map((id) => {
      const model = effectiveModel(id, config)
      return {
        provider,
        id,
        name: model.name === '' ? id : model.name,
        description: describeModel(model, provider),
        inputModalities: model.input,
      }
    })
  }

  /** Recent routing decisions, newest first; no keys or prompt content. */
  routingTrace(): readonly RoutingTraceEntry[] {
    return [...this.routing]
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const config = this.deps.config()
    const meta = effectiveModel(model, config)
    const maxTokens = effectiveMaxTokens(meta, config)
    return {
      provider,
      id: model,
      name: meta.name === '' ? model : meta.name,
      description: describeModel(meta, provider),
      inputModalities: meta.input,
      context: { contextWindow: meta.contextWindow },
      ...(maxTokens === undefined ? {} : { defaultMaxTokens: maxTokens }),
      ...(meta.reasoning.length === 0
        ? {}
        : {
            reasoning: {
              efforts: meta.reasoning.map((effort) => ({
                id: ReasoningEffortId(effort),
                name: effort,
              })),
            },
          }),
    }
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.run(options, false)
  }

  private async *run(options: GenerateOptions, fallback: boolean): AsyncIterable<StreamChunk> {
    const record = this.deps.recordRequest
      ?? ((provider: string, model: string, purpose?: string, account?: string, reason?: string, outcome?: RequestOutcome) =>
        defaultRecordRequest(provider, model, outcome?.at ?? Date.now(), purpose, account, reason, outcome))
    const config = this.deps.config()
    const runStartedAt = Date.now()
    const model = effectiveModel(options.model, config)
    const sessionId = openCodeSessionId(options)
    const rawKeys = orderKeysForModel(
      this.deps.resolveKeys !== undefined
        ? await this.deps.resolveKeys(options.provider)
        : [await this.deps.resolveKey(options.provider)],
      options.model,
      config.modelAccountRules,
    )
    const rule = matchModelAccount(options.model, config.modelAccountRules)
    let keys = rawKeys
    let reason: RoutingReason = rule === undefined ? 'default' : 'rule'
    if (fallback) {
      reason = 'quota-fallback'
    } else if (config.activeAccount !== '') {
      reason = 'pinned'
    } else if (config.stickySession && rule === undefined) {
      const previous = this.sticky.get(sessionId)
      if (previous !== undefined) {
        const preferred = rawKeys.find((entry) => this.keyId(entry.key) === previous.fingerprint)
        if (preferred !== undefined) {
          keys = [preferred, ...rawKeys.filter((entry) => entry !== preferred)]
          reason = 'sticky'
        }
      }
    }
    const initial = keys.find((entry) => fallback || !this.coolingDown(entry.key)) ?? keys[0]
    const url = endpointFor(options.provider, model.transport, options.model, config)
    let images: ImageMap | undefined
    if (hasImages(options)) {
      const store = this.deps.resolveAttachments?.()
      if (store === undefined) {
        throw new LlmError(
          'llm-opencode: image input requires the durable attachment service',
          'UNSUPPORTED_CONTENT',
        )
      }
      images = await resolveImages(options, store, options.signal)
    }
    let bodyOptions: GenerateOptions = options
    if (options.tools !== undefined) {
      const limited = limitTools(options.tools) ?? []
      if (limited.length < options.tools.length && !this.warnedTools) {
        this.warnedTools = true
        this.deps.warn?.(
          `llm-opencode: provider accepts at most ${MAX_TOOLS} tools; `
          + `${options.tools.length - limited.length} tool declaration(s) omitted`,
        )
      }
      bodyOptions = { ...options, tools: limited }
    }
    const body = model.transport === 'openai-chat'
      ? buildChatBody(bodyOptions, model, config, images)
      : model.transport === 'anthropic'
        ? buildAnthropicBody(bodyOptions, model, config, images)
        : model.transport === 'openai-responses'
          ? buildResponsesBody(bodyOptions, model, config, images)
          : buildGoogleBody(bodyOptions, model, config, images)

    let lastError: LlmError | undefined
    let lastAccount = initial?.label ?? 'default'
    let loggedAny = false
    for (const [index, entry] of keys.entries()) {
      if (!fallback && this.coolingDown(entry.key)) continue
      lastAccount = entry.label ?? 'default'
      const attemptReason: RoutingReason = index === 0 ? reason : 'rotation'
      const attemptStartedAt = Date.now()
      let started = false
      let responseFailure = false
      let firstChunkAt: number | undefined
      let logged = false
      const logAttempt = (ok: boolean, errorCode?: string): void => {
        if (logged) return
        logged = true
        loggedAny = true
        record(
          options.provider,
          options.model,
          options.purpose,
          entry.label ?? 'default',
          attemptReason,
          {
            at: attemptStartedAt,
            ok,
            latencyMs: Math.max(0, Date.now() - attemptStartedAt),
            ...(firstChunkAt === undefined
              ? {}
              : { ttftMs: Math.max(0, firstChunkAt - attemptStartedAt) }),
            ...(errorCode === undefined ? {} : { error: errorCode }),
          },
        )
      }
      try {
        const response = await this.send(
          url,
          entry.key,
          sessionId,
          model.transport,
          body,
          config,
          options.signal,
        )
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          const error = classifyResponseError(response.status, text, response.headers)
          lastError = error
          logAttempt(false, error.code)
          const canRotate = index < keys.length - 1
          const retryable = error.code === 'INVALID_CREDENTIAL'
            || error.code === 'RATE_LIMIT'
            || error.code === 'QUOTA'
          if (retryable) {
            // Mark even the last account: its rejection is the reason the turn
            // ends, and the next request (and the UI) must see the cooldown.
            if (!fallback) this.markCooldown(entry.key, response.status, response.headers, error.code)
            responseFailure = true
            if (canRotate) continue
          }
          throw error
        }

        for await (const chunk of this.parse(response, model.transport, config, options.signal)) {
          if (firstChunkAt === undefined) firstChunkAt = Date.now()
          started = true
          yield chunk
        }
        logAttempt(true)
        this.rememberSticky(sessionId, options, entry)
        this.pushTrace({
          at: Date.now(),
          provider: options.provider,
          model: options.model,
          account: entry.label ?? 'default',
          reason: attemptReason,
          fallback,
          ok: true,
        })
        return
      } catch (error) {
        const classified = error instanceof LlmError ? error : new LlmError(
          error instanceof Error ? error.message : 'OpenCode request failed',
          'TRANSPORT',
          { cause: error },
        )
        logAttempt(false, classified.code)
        if (started || options.signal?.aborted === true) {
          this.pushTrace({
            at: Date.now(),
            provider: options.provider,
            model: options.model,
            account: entry.label ?? 'default',
            reason: attemptReason,
            fallback,
            ok: false,
            error: classified.code,
          })
          throw error
        }
        lastError = classified
        const transient = this.isTransient(classified)
        if (transient && !responseFailure && !fallback) this.markCooldown(entry.key, 0)
        const canRotate = index < keys.length - 1 && transient
        if (!canRotate) {
          const canFallback = !fallback
            && config.quotaFallbackModel !== ''
            && isGoProvider(options.provider)
            && classified.code === 'QUOTA'
          if (canFallback) break
          throw classified
        }
      }
    }

    const finalError = lastError ?? new LlmError(
      'llm-opencode: every configured account is cooling down after provider rejections',
      'RATE_LIMIT',
    )
    if (!loggedAny) {
      record(
        options.provider,
        options.model,
        options.purpose,
        lastAccount,
        reason,
        {
          at: runStartedAt,
          ok: false,
          latencyMs: 0,
          error: finalError.code,
        },
      )
    }
    this.pushTrace({
      at: Date.now(),
      provider: options.provider,
      model: options.model,
      account: lastAccount,
      reason,
      fallback,
      ok: false,
      error: finalError.code,
    })
    if (!fallback && config.quotaFallbackModel !== ''
      && isGoProvider(options.provider)
      && (lastError === undefined || lastError.code === 'QUOTA')) {
      try {
        yield* this.run(
          { ...options, provider: CONSOLE_PROVIDER, model: config.quotaFallbackModel },
          true,
        )
        return
      } catch {
        throw finalError
      }
    }
    throw finalError
  }

  private rememberSticky(
    sessionId: string,
    options: GenerateOptions,
    entry: ResolvedKey,
  ): void {
    if (!this.deps.config().stickySession) return
    if (!this.sticky.has(sessionId) && this.sticky.size >= 500) {
      const oldest = this.sticky.keys().next().value
      if (oldest !== undefined) this.sticky.delete(oldest)
    }
    this.sticky.set(sessionId, {
      fingerprint: this.keyId(entry.key),
      label: entry.label ?? 'default',
      provider: options.provider,
      model: options.model,
      at: Date.now(),
    })
    this.persistSticky()
  }

  /** Await pending sticky persistence writes (tests and shutdown). */
  async flushSticky(): Promise<void> {
    await this.stickyWrites
  }

  private loadSticky(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.stickyPath, 'utf8')) as { sticky?: unknown }
      const entries = parsed.sticky
      if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) return
      for (const [sessionId, value] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
        const record = value as Record<string, unknown>
        const fingerprint = record.fingerprint
        const label = record.label
        const provider = record.provider
        const model = record.model
        const at = record.at
        if (typeof fingerprint !== 'string' || !/^[0-9a-f]{16}$/.test(fingerprint)) continue
        if (typeof label !== 'string' || label === '') continue
        if (typeof provider !== 'string' || provider === '') continue
        if (typeof model !== 'string' || model === '') continue
        if (typeof at !== 'number' || !Number.isFinite(at)) continue
        this.sticky.set(sessionId, { fingerprint, label, provider, model, at })
      }
      this.pruneSticky()
    } catch {
      // Missing or corrupt state is ignored; sticky routing is an optimization.
    }
  }

  private pruneSticky(): void {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
    for (const [sessionId, entry] of this.sticky) {
      if (entry.at < cutoff) this.sticky.delete(sessionId)
    }
    const overflow = this.sticky.size - 500
    if (overflow <= 0) return
    const oldest = [...this.sticky.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, overflow)
    for (const [sessionId] of oldest) this.sticky.delete(sessionId)
  }

  private persistSticky(): void {
    this.pruneSticky()
    const payload = JSON.stringify({ sticky: Object.fromEntries(this.sticky) })
    this.stickyWrites = this.stickyWrites
      .then(async () => {
        await mkdir(dirname(this.stickyPath), { recursive: true })
        await writeFile(this.stickyPath, payload, 'utf8')
      })
      .catch(() => {})
  }

  private pushTrace(entry: RoutingTraceEntry): void {
    this.routing.unshift(entry)
    if (this.routing.length > 20) this.routing.length = 20
  }

  private parse(
    response: Response,
    transport: EffectiveModel['transport'],
    config: ResolvedConfig,
    signal: AbortSignal | undefined,
  ): AsyncIterable<StreamChunk> {
    if (transport === 'anthropic') return parseAnthropicStream(response, config.streamIdleTimeoutMs, signal)
    if (transport === 'openai-responses') return parseResponsesStream(response, config.streamIdleTimeoutMs, signal)
    if (transport === 'google') return parseGoogleStream(response, config.streamIdleTimeoutMs, signal)
    return parseChatStream(response, config.streamIdleTimeoutMs, signal)
  }

  private async send(
    url: string,
    key: string,
    sessionId: string,
    transport: EffectiveModel['transport'],
    body: Record<string, unknown>,
    config: ResolvedConfig,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      ...attributionHeaders(),
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-opencode-session': sessionId,
      'user-agent': config.userAgent,
      ...(transport === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}),
    }

    const controller = new AbortController()
    let timedOut = false
    const onAbort = (): void => controller.abort(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, config.requestTimeoutMs)
    timer.unref?.()

    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason ?? error
      if (timedOut) {
        throw new LlmError(
          `OpenCode did not return response headers within ${config.requestTimeoutMs}ms`,
          'TIMEOUT',
          { cause: error },
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  private keyId(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 16)
  }

  private coolingDown(key: string): boolean {
    const id = this.keyId(key)
    const entry = this.cooldowns.get(id)
    if (entry === undefined) return false
    if (entry.until <= Date.now()) {
      this.cooldowns.delete(id)
      return false
    }
    return true
  }

  /** Current cooldown for one resolved key, if any. */
  accountHealth(key: string): { coolingUntil: number; reason: string } | undefined {
    const id = this.keyId(key)
    const entry = this.cooldowns.get(id)
    if (entry === undefined) return undefined
    if (entry.until <= Date.now()) {
      this.cooldowns.delete(id)
      return undefined
    }
    return { coolingUntil: entry.until, reason: entry.reason }
  }

  /** Await pending cooldown persistence writes (tests and shutdown). */
  async flushCooldowns(): Promise<void> {
    await this.cooldownWrites
  }

  private loadCooldowns(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.cooldownPath, 'utf8')) as { cooldowns?: unknown }
      const entries = parsed.cooldowns
      if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) return
      for (const [id, value] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
        const until = (value as { until?: unknown }).until
        const reason = (value as { reason?: unknown }).reason
        if (typeof until !== 'number' || !Number.isFinite(until) || until <= Date.now()) continue
        if (typeof reason !== 'string' || reason === '') continue
        this.cooldowns.set(id, { until, reason })
      }
      this.pruneCooldowns()
    } catch {
      // Missing or corrupt state is ignored; cooldowns are an optimization.
    }
  }

  private pruneCooldowns(): void {
    const now = Date.now()
    for (const [id, entry] of this.cooldowns) {
      if (entry.until <= now) this.cooldowns.delete(id)
    }
    const overflow = this.cooldowns.size - 50
    if (overflow <= 0) return
    const oldest = [...this.cooldowns.entries()]
      .sort((a, b) => a[1].until - b[1].until)
      .slice(0, overflow)
    for (const [id] of oldest) this.cooldowns.delete(id)
  }

  private persistCooldowns(): void {
    this.pruneCooldowns()
    const payload = JSON.stringify({ cooldowns: Object.fromEntries(this.cooldowns) })
    this.cooldownWrites = this.cooldownWrites
      .then(async () => {
        await mkdir(dirname(this.cooldownPath), { recursive: true })
        await writeFile(this.cooldownPath, payload, 'utf8')
      })
      .catch(() => {})
  }

  private markCooldown(key: string, status: number, headers?: Headers, code?: string): void {
    let delayMs = 30_000
    let reason = 'transport'
    if (code === 'QUOTA' || status === 402) {
      const raw = headers?.get('retry-after')
      const seconds = raw === null || raw === undefined ? Number.NaN : Number(raw)
      delayMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 10 * 60 * 1000
      reason = 'quota'
    } else if (code === 'RATE_LIMIT' || status === 429) {
      // A free-tier restriction is account/model-specific, not proof that the
      // key itself is invalid; do not take the account out for 24 hours.
      const raw = headers?.get('retry-after')
      const seconds = raw === null || raw === undefined ? Number.NaN : Number(raw)
      delayMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000
      reason = 'rate-limit'
    } else if (status === 401 || status === 403) {
      delayMs = 24 * 60 * 60 * 1000
      reason = 'invalid-credential'
    }
    this.cooldowns.set(this.keyId(key), { until: Date.now() + delayMs, reason })
    this.persistCooldowns()
  }

  private isTransient(error: LlmError): boolean {
    return error.code === 'RATE_LIMIT'
      || error.code === 'QUOTA'
      || error.code === 'SERVER'
      || error.code === 'TIMEOUT'
      || error.code === 'TRANSPORT'
      || error.code === 'EMPTY_RESPONSE'
  }
}
