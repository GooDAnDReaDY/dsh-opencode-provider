import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the `ctx.attachments` and `ctx.settings` service merges into this program.
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'

import { OpenCodeAdapter } from './adapter.ts'
import { applyCommands } from './commands.ts'
import { Config, NS, resolveConfig, unwrapVolatileConfig } from './config.ts'
import { createKeyPool, openCodeAuthPath } from './credentials.ts'
import { registerPluginUpdater } from './plugin-updater.ts'
import { applyRoutes } from './routes.ts'
import { readRequestHeatmap } from './request-log.ts'
import { applyOpenCodeTuiSettings } from './tui-settings.ts'
import { createUsageReader } from './usage.ts'

export const name = 'llm-opencode'
export const inject = ['llm']

export { Config }
export { OpenCodeAdapter }
export type { OpenCodeAdapterDeps } from './adapter.ts'
export type { Config as OpenCodeConfig, ResolvedConfig, TransportId } from './config.ts'
export type { ResolvedKey } from './credentials.ts'
export { createKeyPool, createKeyResolver } from './credentials.ts'
export { applyCommands } from './commands.ts'
export type { CommandDeps } from './commands.ts'
export { applyRoutes } from './routes.ts'
export type { RouteDeps } from './routes.ts'
export type { UsageReport, UsageResult, UsageWindow } from './usage.ts'
export { openCodeAuthPath }
export { normalizeUsage, createUsageReader } from './usage.ts'
export { openCodeSessionId } from './session-id.ts'
export { classifyResponseError } from './errors.ts'
export { clearCatalogCache, describeModel, effectiveModel } from './catalog.ts'

/**
 * Register both provider routes against the dsh `llm` service:
 *
 * - `opencode`    — Console / Zen pay-as-you-go.
 * - `opencode-go` — Go / Go Plus subscription (same API, Go base path, quotas).
 *
 * Requests resolve their key per call, so a changed credential reaches the
 * next request without a restart.
 */
export function apply(ctx: Context, config: Config): void {
  const current = () => resolveConfig(unwrapVolatileConfig(config))
  const keys = createKeyPool(ctx, current)
  const usage = createUsageReader(current, (provider) => keys.resolve(provider))
  const adapter = new OpenCodeAdapter({
    config: current,
    resolveKey: (provider) => keys.resolve(provider),
    resolveKeys: (provider) => keys.resolveAll(provider),
    resolveAttachments: () => ctx.get('attachments'),
    warn: (message) => ctx.logger('llm-opencode').warn(message),
  })

  ctx.llm.registerConfigurableProviders([
    { provider: 'opencode', displayName: 'OpenCode', settingsNs: NS, settingsPath: [] },
    { provider: 'opencode-go', displayName: 'OpenCode Go', settingsNs: NS, settingsPath: [] },
  ])
  ctx.llm.registerAdapter(['opencode', 'opencode-go'], adapter)
  ctx.logger('llm-opencode').info('registered providers: opencode, opencode-go')

  // The plugin ships no custom UI yet; declaring that keeps SettingsForms from
  // publishing an auto-generated page for this entry. A profile without the
  // settings service keeps using the composition config `apply()` received.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.configure({ auto: false }, ctx.fiber)
  })

  ctx.inject(['commands'], (commandCtx) => {
    applyCommands(commandCtx, { config: current, pool: keys, usage, adapter })
  })

  let refreshTuiSettings: (() => void) | undefined
  ctx.inject(['tuiSettingsSections'], (tuiCtx) => {
    refreshTuiSettings = applyOpenCodeTuiSettings(tuiCtx, {
      ns: NS,
      title: 'OpenCode',
      apiKeyRef: () => current().apiKeyEnv,
      accountSlots: () => [
        { id: 'default', label: 'default' },
        ...current().accounts.map((account, index) => ({
          id: typeof account.label === 'string' && account.label.trim() !== ''
            ? account.label.trim()
            : `account-${index + 2}`,
          label: typeof account.label === 'string' && account.label.trim() !== ''
            ? account.label.trim()
            : `account-${index + 2}`,
        })),
      ],
      visibleModels: () => current().visibleModels,
      activeAccount: () => current().activeAccount,
      filterModelsByPlan: () => current().filterModelsByPlan,
      quotaFallbackModel: () => current().quotaFallbackModel,
      stickySession: () => current().stickySession,
    })
  })

  ctx.inject(['webServer'], (webCtx) => {
    applyRoutes(webCtx, webCtx.webServer, {
      config: current,
      adapter,
      pool: keys,
      usage,
      heatmap: readRequestHeatmap,
      refreshTui: () => refreshTuiSettings?.(),
    })
    webCtx.effect(() => registerPluginUpdater(webCtx, {
      endpoint: '/dsh-opencode/update',
      packageName: '@goodandready/dsh-opencode-provider',
      manifestUrl: new URL('../package.json', import.meta.url),
    }), 'dsh-opencode-provider: plugin updater')
  })
}
