import { deflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { OpenCodeAdapter } from '../lib/index.js'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const name = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}

function redPng(size = 32) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.alloc(1 + size * 3)
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = 255
    row[2 + x * 3] = 0
    row[3 + x * 3] = 0
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const auth = JSON.parse(readFileSync(
  join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'auth.json'),
  'utf8',
))
const key = auth['opencode-go']?.key
if (typeof key !== 'string' || key === '') throw new Error('no opencode-go key in auth.json')

const png = redPng(32)
const attachment = {
  attachmentId: 'img_red_32',
  mediaType: 'image/png',
  bytes: png.length,
  width: 32,
  height: 32,
  name: 'red.png',
}

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
  resolveAttachments: () => ({
    readImageRequest: async () => ({
      data: png,
      mediaType: 'image/png',
      bytes: png.length,
      width: 32,
      height: 32,
    }),
  }),
})

for (const model of ['deepseek-v4.1-flash', 'claude-haiku-5-5', 'gpt-6-luna', 'gemini-4-argon-contributor']) {
  let text = ''
  let finish = null
  let error = null
  try {
    for await (const chunk of adapter.stream({
      provider: 'opencode-go',
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is the dominant color of this image? Reply with one word.' },
          { type: 'image', attachment },
        ],
      }],
      maxTokens: 256,
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish') finish = chunk.reason
    }
  } catch (caught) {
    error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught)
  }
  console.log(model, JSON.stringify({ text, finish, error }))
}
