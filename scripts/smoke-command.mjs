import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { applyCommands, createUsageReader } from '../lib/index.js'

const auth = JSON.parse(readFileSync(
  join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'auth.json'),
  'utf8',
))
const key = auth['opencode-go']?.key
if (typeof key !== 'string' || key === '') throw new Error('no opencode-go key in auth.json')

const config = {
  apiKeyEnv: 'OPENCODE_API_KEY',
  apiBase: 'https://opencode.ai/inference',
  goApiBase: 'https://opencode.ai/inference/go',
  goZenBase: 'https://opencode.ai/zen/go/v1',
  usageUrl: 'https://opencode.ai/zen/go/v1/usage',
  openCodeAuthEntry: 'opencode-go',
  requestTimeoutMs: 300_000,
  streamIdleTimeoutMs: 300_000,
  visibleModels: [],
  modelVisibility: {},
  modelTransports: {},
  contextWindowOverrides: {},
  accounts: [],
  activeAccount: '',
  showSidebarQuota: false,
  userAgent: 'dsh-opencode-provider/0.1.0',
}

const pool = {
  resolve: async () => ({ key, source: 'auth.json:opencode-go' }),
  resolveAll: async () => [{ key, source: 'auth.json:opencode-go' }],
}
const usage = createUsageReader(() => config, (provider) => pool.resolve(provider))

let definition
applyCommands({ commands: { register(value) { definition = value } } }, {
  config: () => config,
  pool,
  usage,
})

const result = await definition.handler({
  rawInput: '',
  commandId: 'cmd_test',
  agent: {},
  attachments: [],
  signal: new AbortController().signal,
})
console.log(result.text)
