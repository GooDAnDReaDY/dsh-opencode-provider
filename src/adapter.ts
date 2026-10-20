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
import { orderKeysForModel } from './account-rules.ts'
import type { ResolvedConfig } from './config.ts'
import type { KeyResolver, ResolvedKey } from './credentials.ts'
import { classifyResponseError } from './errors.ts'
import { hasImages, resolveImages, type ImageMap } from './images.ts'
import { buildChatBody } from './messages.ts'
import { endpointFor, isGoProvider } from './routing.ts'
import { recordRequest as defaultRecordRequest } from './request-log.ts'
import { openCodeSessionId } from './session-id.ts'
import { limitTools, MAX_TOOLS } from './tools.ts'
import { buildAnthropicBody, parseAnthropicStream } from './transports/anthropic.ts'
import { buildGoogleBody, parseGoogleStream } from './transports/google.ts'
import { parseChatStream } from './transports/openai-chat.ts'
import { buildResponsesBody, parseResponsesStream } from './transports/responses.ts'

export interface OpenCodeAdapterDeps {
  readonly config: () => ResolvedConfig
  readonly resolveKey: KeyResolver
  readonly resolveKeys?: (provider: string) => Promise<readonly ResolvedKey[]>
  readonly resolveAttachments?: () => AttachmentStore | undefined
  readonly fetchImpl?: typeof fetch
  /** Test seam; defaults to the local append-only request log. */
  readonly recordRequest?: (provider: string, model: string, purpose?: string) => void
  /** Test seam; defaults to ~/.dsh/storages/dsh-opencode/cooldowns.json. */
  readonly cooldownPath?: string
  /** Receives a one-time warning when the provider tool limit drops tools. */
  readonly warn?: (message: string) => void
}

function defaultCooldownPath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-opencode', 'cooldowns.json')
}

export class OpenCodeAdapter extends LlmAdapter {
  private readonly fetchImpl: typeof fetch
  private readonly cooldownPath: string
  private cooldownWrites: Promise<void> = Promise.resolve()
  /** key fingerprint → cooldown deadline and the rejection that caused it. */
  private readonly cooldowns = new Map<string, { until: number; reason: string }>()
  private warnedTools = false

  constructor(private readonly deps: OpenCodeAdapterDeps) {
    super()
    this.fetchImpl = deps.fetchImpl ?? fetch
    this.cooldownPath = deps.cooldownPath ?? defaultCooldownPath()
    this.loadCooldowns()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return {
      id: provider,
      name: isGoProvider(provider) ? 'OpenCode Go' : 'OpenCode',
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
    return this.run(options)
  }

  private async *run(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const record = this.deps.recordRequest
      ?? ((provider: string, model: string, purpose?: string) =>
        defaultRecordRequest(provider, model, Date.now(), purpose))
    record(options.provider, options.model, options.purpose)
    const config = this.deps.config()
    const model = effectiveModel(options.model, config)
    const keys = orderKeysForModel(
      this.deps.resolveKeys !== undefined
        ? await this.deps.resolveKeys(options.provider)
        : [await this.deps.resolveKey(options.provider)],
      options.model,
      config.modelAccountRules,
    )
    const sessionId = openCodeSessionId(options)
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
    for (const [index, entry] of keys.entries()) {
      if (this.coolingDown(entry.key)) continue
      let started = false
      let responseFailure = false
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
          const canRotate = index < keys.length - 1
          const retryable = error.code === 'INVALID_CREDENTIAL'
            || error.code === 'RATE_LIMIT'
            || error.code === 'QUOTA'
          if (retryable) {
            // Mark even the last account: its rejection is the reason the turn
            // ends, and the next request (and the UI) must see the cooldown.
            this.markCooldown(entry.key, response.status, response.headers, error.code)
            responseFailure = true
            if (canRotate) continue
          }
          throw error
        }

        for await (const chunk of this.parse(response, model.transport, config, options.signal)) {
          started = true
          yield chunk
        }
        return
      } catch (error) {
        if (started || options.signal?.aborted === true) throw error
        const classified = error instanceof LlmError ? error : new LlmError(
          error instanceof Error ? error.message : 'OpenCode request failed',
          'TRANSPORT',
          { cause: error },
        )
        lastError = classified
        const transient = this.isTransient(classified)
        if (transient && !responseFailure) this.markCooldown(entry.key, 0)
        const canRotate = index < keys.length - 1 && transient
        if (!canRotate) throw classified
      }
    }

    throw lastError ?? new LlmError(
      'llm-opencode: every configured account is cooling down after provider rejections',
      'RATE_LIMIT',
    )
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
    } else if (status === 401 || status === 403) {
      delayMs = 24 * 60 * 60 * 1000
      reason = 'invalid-credential'
    } else if (status === 429) {
      const raw = headers?.get('retry-after')
      const seconds = raw === null || raw === undefined ? Number.NaN : Number(raw)
      delayMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000
      reason = 'rate-limit'
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
