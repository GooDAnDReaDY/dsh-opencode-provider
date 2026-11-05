import type { CommandLocale } from './config.ts'

export interface CommandCopy {
  readonly provider: string
  readonly noCredential: string
  readonly active: string
  readonly cooling: string
  readonly rules: string
  readonly auth: string
  readonly none: string
  readonly noRules: string
  readonly noModels: string
  readonly modelsUnavailable: string
  readonly unknown: string
  readonly quotaUnavailable: string
  readonly noWindows: string
  readonly testFailed: string
  readonly resets: string
  readonly fiveHour: string
  readonly weekly: string
  readonly monthly: string
}

const en: CommandCopy = {
  provider: 'OpenCode provider',
  noCredential: 'no credential',
  active: 'active',
  cooling: 'cooling',
  rules: 'Rules',
  auth: 'Auth',
  none: 'none',
  noRules: 'No model → account rules.',
  noModels: 'No models.',
  modelsUnavailable: 'Models unavailable',
  unknown: 'Unknown /opencode argument',
  quotaUnavailable: 'Quota unavailable',
  noWindows: 'No quota windows returned.',
  testFailed: 'failed',
  resets: 'resets',
  fiveHour: '5h',
  weekly: 'weekly',
  monthly: 'monthly',
}

const zh: CommandCopy = {
  provider: 'OpenCode 提供商',
  noCredential: '未配置凭据',
  active: '活动',
  cooling: '冷却中',
  rules: '规则',
  auth: '认证',
  none: '无',
  noRules: '没有模型 → 账户规则。',
  noModels: '没有模型。',
  modelsUnavailable: '模型不可用',
  unknown: '未知的 /opencode 参数',
  quotaUnavailable: '配额不可用',
  noWindows: '未返回配额窗口。',
  testFailed: '失败',
  resets: '重置',
  fiveHour: '5小时',
  weekly: '每周',
  monthly: '每月',
}

export function commandCopy(locale: CommandLocale): CommandCopy {
  return locale === 'zh' ? zh : en
}
