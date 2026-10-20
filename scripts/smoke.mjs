import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { OpenCodeAdapter } from '../lib/index.js'

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

const adapter = new OpenCodeAdapter({
  config: () => config,
  resolveKey: async () => ({ key, source: 'auth.json:opencode-go' }),
})

let text = ''
let reasoning = ''
let usage = null
let finish = null

for await (const chunk of adapter.stream({
  provider: 'opencode-go',
  model: 'deepseek-v4.1-flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] }],
  maxTokens: 16,
})) {
  if (chunk.type === 'text-delta') text += chunk.text
  else if (chunk.type === 'reasoning-delta') reasoning += chunk.text
  else if (chunk.type === 'usage') usage = chunk.usage
  else if (chunk.type === 'finish') finish = chunk.reason
}

console.log(JSON.stringify({ text, reasoning: reasoning.slice(0, 80), usage, finish }, null, 2))
