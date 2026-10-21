/**
 * Provider ids owned by this plugin. The built-in llm-pi-ai catalog already
 * declares `opencode` and `opencode-go`; the core registry rejects duplicate
 * configurable provider ids and would drop the whole catalog when they clash.
 */
export const CONSOLE_PROVIDER = 'opencode-direct'
export const GO_PROVIDER = 'opencode-go-direct'

/** Historical ids written by earlier releases; used only for analytics continuity. */
export const LEGACY_CONSOLE_PROVIDER = 'opencode'
export const LEGACY_GO_PROVIDER = 'opencode-go'

export const PLUGIN_PROVIDERS = [CONSOLE_PROVIDER, GO_PROVIDER] as const

export const PLUGIN_PROVIDER_SET: ReadonlySet<string> = new Set(PLUGIN_PROVIDERS)
