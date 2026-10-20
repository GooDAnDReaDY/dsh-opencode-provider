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

const tools = [{
  name: 'bash',
  description: 'Run a shell command.',
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
  },
}]

async function collect(options) {
  const calls = []
  let text = ''
  let finish = null
  let replayState = null
  for await (const chunk of adapter.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') calls.push(chunk.block)
    else if (chunk.type === 'finish') {
      finish = chunk.reason
      replayState = chunk.replayState ?? null
    }
  }
  return { calls, text, finish, replayState }
}

for (const model of ['deepseek-v4.1-flash', 'claude-haiku-5-5', 'gpt-6-luna', 'grok-4.7', 'muse-spark-1.3-contributor', 'gemini-4-argon-contributor', 'qwen3.8-max']) {
  let error = null
  try {
    const first = await collect({
      provider: 'opencode-go',
      model,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Call the bash tool with command: echo hi.' }] }],
      tools,
      maxTokens: 256,
    })
    const call = first.calls[0]
    if (call === undefined) {
      console.log(model, JSON.stringify({ error: 'no tool call', first }))
      continue
    }
    const second = await collect({
      provider: 'opencode-go',
      model,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Call the bash tool with command: echo hi.' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool-call', id: call.id, name: call.name, arguments: call.arguments }],
          source: {
            kind: 'model',
            provider: 'opencode-go',
            model,
            ...(first.replayState === null ? {} : { replayState: first.replayState }),
          },
        },
        {
          role: 'tool',
          content: [{ type: 'text', text: 'hi' }],
          toolCallId: call.id,
          source: { kind: 'tool', callId: call.id },
        },
      ],
      tools,
      maxTokens: 256,
    })
    console.log(model, JSON.stringify({ first: first.finish, second: second.finish, text: second.text.slice(0, 80) }))
  } catch (caught) {
    error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught)
    console.log(model, JSON.stringify({ error }))
  }
}
