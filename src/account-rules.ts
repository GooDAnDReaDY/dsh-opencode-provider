import type { ModelAccountRule } from './config.ts'
import type { ResolvedKey } from './credentials.ts'

function glob(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

/** First matching rule wins; an empty pattern or account is ignored. */
export function matchModelAccount(
  model: string,
  rules: readonly ModelAccountRule[],
): string | undefined {
  for (const rule of rules) {
    if (rule.pattern === '' || rule.account === '') continue
    if (glob(rule.pattern).test(model)) return rule.account
  }
  return undefined
}

/**
 * Pin the matching account first, keeping the rest as fallbacks. A rule that
 * names an account not present in the pool is a no-op.
 */
export function orderKeysForModel(
  keys: readonly ResolvedKey[],
  model: string,
  rules: readonly ModelAccountRule[],
): readonly ResolvedKey[] {
  const account = matchModelAccount(model, rules)
  if (account === undefined) return keys
  const preferred = keys.find((entry) => (entry.label ?? 'default') === account)
  if (preferred === undefined) return keys
  return [preferred, ...keys.filter((entry) => entry !== preferred)]
}
