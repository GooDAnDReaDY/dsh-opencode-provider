import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { OpenCodeAdapter } from '../lib/index.js'

const auth = JSON.parse(readFileSync(
  join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'auth.json'),
  'utf8',
))
const good = auth['opencode-go']?.key
if (typeof good !== 'string' || good === '') throw new Error('no opencode-go key in auth.json')
const bad = `oc_sk_${'0'.repeat(32)}_${'x'.repeat(12)}`

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

let calls = 0
const attempts = []
const adapter = new OpenCodeAdapter({
  config: () => config,
  resolveKey: async () => ({ key: bad, source: 'bad' }),
  resolveKeys: async () => {
    calls += 1
    return [{ key: bad, source: 'bad' }, { key: good, source: 'auth.json' }]
  },
  fetchImpl: async (url, init) => {
    attempts.push(init?.headers?.authorization === `Bearer ${bad}` ? 'bad' : 'good')
    return fetch(url, init)
  },
})

let text = ''
let finish = null
for await (const chunk of adapter.stream({
  provider: 'opencode-go',
  model: 'deepseek-v4.1-flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] }],
  maxTokens: 64,
})) {
  if (chunk.type === 'text-delta') text += chunk.text
  else if (chunk.type === 'finish') finish = chunk.reason
}
console.log(JSON.stringify({ calls, attempts, text, finish }))
