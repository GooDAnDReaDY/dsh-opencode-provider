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

const models = ['deepseek-v4.1-flash', 'claude-haiku-5-5', 'gpt-6-luna', 'gemini-4-argon-contributor', 'minimax-m3']

for (const model of models) {
  const calls = []
  let finish = null
  let error = null
  try {
    for await (const chunk of adapter.stream({
      provider: 'opencode-go',
      model,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Call the bash tool with exactly: echo hi. Do not answer in text.' }],
      }],
      tools: [{
        name: 'bash',
        description: 'Run a shell command.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      }],
      maxTokens: 256,
    })) {
      if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
        calls.push({ id: chunk.block.id, name: chunk.block.name, args: chunk.block.arguments })
      } else if (chunk.type === 'finish') {
        finish = chunk.reason
      }
    }
  } catch (caught) {
    error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught)
  }
  console.log(model, JSON.stringify({ calls, finish, error }))
}
