import type { Context } from '@deepseek-ai/cordis'

/**
 * Minimal structural copy of the dsh-TUI settings seam. The terminal front door
 * is optional, so this module deliberately imports none of its packages.
 */
export type TuiSettingsFieldKind = 'text' | 'number' | 'boolean' | 'select'

export interface TuiSettingsFieldOption {
  readonly value: string
  readonly label: string
}

export type TuiSettingsFieldWrite =
  | { readonly kind: 'set'; readonly value: unknown }
  | { readonly kind: 'clear' }

export interface TuiSettingsField {
  readonly path: readonly string[]
  readonly label: string
  readonly hint?: string
  readonly group?: string
  readonly kind: TuiSettingsFieldKind
  readonly options?: readonly TuiSettingsFieldOption[]
  readonly placeholder?: string
  readonly secret?: { readonly ref: string }
  readonly format?: (value: unknown) => string
  readonly parse?: (text: string) => TuiSettingsFieldWrite | undefined
}

export interface TuiSettingsGroup {
  readonly id: string
  readonly title: string
}

export interface TuiSettingsSection {
  readonly ns: string
  readonly title: string
  readonly groups?: readonly TuiSettingsGroup[]
  readonly fields: readonly TuiSettingsField[]
}

export interface TuiSettingsSectionsService {
  register(section: TuiSettingsSection): () => void
}

export interface OpenCodeTuiSettingsDeps {
  readonly ns: string
  readonly title?: string
  readonly apiKeyRef: () => string
  readonly accountSlots: () => readonly { id: string; label: string }[]
  readonly visibleModels: () => readonly string[]
  readonly activeAccount: () => string
  readonly filterModelsByPlan: () => boolean
  readonly quotaFallbackModel: () => string
  readonly stickySession: () => boolean
  readonly showSidebarQuota: () => boolean
  /** Poll interval for settings changed from inside the terminal UI. */
  readonly refreshMs?: number
}

export const TUI_ACCOUNT_AUTO = 'auto'

function setOrClear(text: string): TuiSettingsFieldWrite {
  const trimmed = text.trim()
  return trimmed === '' ? { kind: 'clear' } : { kind: 'set', value: trimmed }
}

function numberOrInvalid(text: string): TuiSettingsFieldWrite | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'clear' }
  const value = Number(trimmed)
  return Number.isInteger(value) && value > 0 ? { kind: 'set', value } : undefined
}

function parseModels(text: string): TuiSettingsFieldWrite {
  const ids = text
    .split(/[,\n]/)
    .map((id) => id.trim())
    .filter((id) => id !== '')
  return ids.length === 0 ? { kind: 'clear' } : { kind: 'set', value: ids }
}

/** Build the terminal settings section without touching a TUI host. */
export function buildOpenCodeTuiSection(deps: OpenCodeTuiSettingsDeps): TuiSettingsSection {
  const slots = deps.accountSlots()
  return {
    ns: deps.ns,
    title: deps.title ?? 'OpenCode',
    groups: [
      { id: 'connection', title: 'Connection' },
      { id: 'models', title: 'Models' },
      { id: 'advanced', title: 'Advanced' },
      { id: 'sidebar', title: 'Sidebar' },
    ],
    fields: [
      {
        path: ['apiKey'],
        group: 'connection',
        kind: 'text',
        label: 'API key',
        secret: { ref: deps.apiKeyRef() },
        hint: `Stored in the credential store as ${deps.apiKeyRef()}, never in settings.yaml.`,
      },
      {
        path: ['apiBase'],
        group: 'connection',
        kind: 'text',
        label: 'Console base',
        placeholder: 'https://opencode.ai/inference',
        hint: 'Leave empty for the public endpoint.',
        parse: setOrClear,
      },
      {
        path: ['goApiBase'],
        group: 'connection',
        kind: 'text',
        label: 'Go inference base',
        placeholder: 'https://opencode.ai/inference/go',
        parse: setOrClear,
      },
      {
        path: ['goZenBase'],
        group: 'connection',
        kind: 'text',
        label: 'Go gateway base',
        placeholder: 'https://opencode.ai/zen/go/v1',
        parse: setOrClear,
      },
      {
        path: ['usageUrl'],
        group: 'connection',
        kind: 'text',
        label: 'Usage endpoint',
        placeholder: 'https://opencode.ai/zen/go/v1/usage',
        parse: setOrClear,
      },
      {
        path: ['visibleModels'],
        group: 'models',
        kind: 'text',
        label: 'Visible models',
        hint: 'Comma-separated model ids. Empty shows every model.',
        format: () => deps.visibleModels().join(', '),
        parse: parseModels,
      },
      {
        path: ['filterModelsByPlan'],
        group: 'models',
        kind: 'boolean',
        label: 'Hide outside Go allowance',
        hint: 'On the Go route, show only Go-table and free models.',
        format: (value) => String(value === undefined ? deps.filterModelsByPlan() : value !== false),
        parse: (text) => ({ kind: 'set', value: text.trim() === 'true' }),
      },
      {
        path: ['quotaFallbackModel'],
        group: 'models',
        kind: 'text',
        label: 'Quota fallback model',
        hint: 'Free model id used once after a Go quota error; empty disables it.',
        format: () => deps.quotaFallbackModel(),
        parse: setOrClear,
      },
      {
        path: ['stickySession'],
        group: 'advanced',
        kind: 'boolean',
        label: 'Sticky account per conversation',
        hint: 'Prefer the last successful account for the same conversation.',
        format: (value) => String(value === undefined ? deps.stickySession() : value !== false),
        parse: (text) => ({ kind: 'set', value: text.trim() === 'true' }),
      },
      {
        path: ['showSidebarQuota'],
        group: 'sidebar',
        kind: 'boolean',
        label: 'Show quota card in sidebar',
        hint: 'Card visibility updates on the next sidebar refresh.',
        format: (value) => String(value === undefined ? deps.showSidebarQuota() : value === true),
        parse: (text) => ({ kind: 'set', value: text.trim() === 'true' }),
      },
      {
        path: ['activeAccount'],
        group: 'advanced',
        kind: 'text',
        label: 'Active account',
        hint: 'A pinned account label, or auto to follow rotation order.',
        options: [
          { value: TUI_ACCOUNT_AUTO, label: 'Automatic (rotation order)' },
          { value: 'default', label: 'default' },
          ...slots.map((slot) => ({ value: slot.id, label: slot.label })),
        ],
        format: () => deps.activeAccount() === '' ? TUI_ACCOUNT_AUTO : deps.activeAccount(),
        parse: (text) => {
          const trimmed = text.trim()
          return trimmed === '' || trimmed === TUI_ACCOUNT_AUTO
            ? { kind: 'clear' }
            : { kind: 'set', value: trimmed }
        },
      },
      {
        path: ['requestTimeoutMs'],
        group: 'advanced',
        kind: 'number',
        label: 'Header timeout (ms)',
        parse: numberOrInvalid,
      },
      {
        path: ['streamIdleTimeoutMs'],
        group: 'advanced',
        kind: 'number',
        label: 'Stream idle timeout (ms)',
        parse: numberOrInvalid,
      },
    ],
  }
}

function tuiService(ctx: Context): TuiSettingsSectionsService | undefined {
  let candidate: unknown
  try {
    candidate = ctx.get('tuiSettingsSections')
  } catch {
    return undefined
  }
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const register = (candidate as { register?: unknown }).register
  if (typeof register !== 'function') return undefined
  return {
    register: (register as (section: TuiSettingsSection) => () => void)
      .bind(candidate) as TuiSettingsSectionsService['register'],
  }
}

/** Register the section and return a refresh function, or undefined without TUI. */
export function applyOpenCodeTuiSettings(
  ctx: Context,
  deps: OpenCodeTuiSettingsDeps,
): (() => void) | undefined {
  const service = tuiService(ctx)
  if (service === undefined) return undefined
  let disposed = false
  let remove: (() => void) | undefined

  const signature = (): string => JSON.stringify({
    apiKeyRef: deps.apiKeyRef(),
    accounts: deps.accountSlots().map((slot) => [slot.id, slot.label]),
    visibleModels: deps.visibleModels(),
    activeAccount: deps.activeAccount(),
    filterModelsByPlan: deps.filterModelsByPlan(),
    quotaFallbackModel: deps.quotaFallbackModel(),
    stickySession: deps.stickySession(),
    showSidebarQuota: deps.showSidebarQuota(),
  })
  let lastSignature = signature()

  const refresh = (): void => {
    if (disposed) return
    remove?.()
    try {
      remove = service.register(buildOpenCodeTuiSection(deps))
    } catch {
      remove = undefined
    }
  }

  refresh()
  const timer = setInterval(() => {
    const next = signature()
    if (next === lastSignature) return
    lastSignature = next
    refresh()
  }, deps.refreshMs ?? 2000)
  ctx.effect(() => () => {
    disposed = true
    clearInterval(timer)
    remove?.()
    remove = undefined
  }, 'dsh-opencode-provider: tui settings section')
  return refresh
}
