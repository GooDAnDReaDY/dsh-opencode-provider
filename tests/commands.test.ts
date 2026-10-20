import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'

import type { OpenCodeAdapter } from '../src/adapter.ts'
import { applyCommands, type CommandDeps } from '../src/commands.ts'
import { resolveConfig } from '../src/config.ts'
import type { KeyPool } from '../src/credentials.ts'
import type { UsageReader } from '../src/usage.ts'

function harness() {
  let definition: unknown
  const ctx = {
    commands: {
      register: (value: unknown) => { definition = value },
    },
  } as unknown as Context

  const config = resolveConfig({
    modelAccountRules: [{ pattern: '*free*', account: 'free' }],
  })
  const pool = {
    resolve: async () => ({ key: 'secret', source: 'test' }),
    resolveAll: async () => [{ key: 'secret', source: 'test', label: 'default' }],
  } as KeyPool
  const usage = Object.assign(
    async () => ({
      report: {
        windows: {
          fiveHour: { percentUsed: 1 },
          weekly: { percentUsed: 2 },
          monthly: { percentUsed: 3 },
        },
      },
      checkedAt: Date.now(),
    }),
    { clear: () => {} },
  ) as unknown as UsageReader

  const adapter = {
    accountHealth: () => undefined,
    listModels: async () => [{
      provider: 'opencode-go',
      id: 'deepseek-v4.1-flash',
      name: 'Flash',
      description: 'test',
      inputModalities: ['text'],
    }],
    async *stream() {
      yield { type: 'text-delta', index: 0, text: 'OK' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  } as unknown as OpenCodeAdapter

  const deps: CommandDeps = {
    config: () => config,
    pool,
    usage: (provider, key) => usage(provider, key),
    adapter,
  }
  applyCommands(ctx, deps)
  return definition as {
    handler: (invocation: { rawInput: string }) => Promise<{ kind: string; text: string }>
  }
}

test('/opencode rules lists model-account rules', async () => {
  const result = await harness().handler({ rawInput: 'rules' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /\*free\* → free/)
})

test('/opencode accounts shows per-account quotas', async () => {
  const result = await harness().handler({ rawInput: 'accounts' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /default/)
  assert.match(result.text, /5h 1%/)
})

test('/opencode test streams a minimal request', async () => {
  const result = await harness().handler({ rawInput: 'test deepseek-v4.1-flash' })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /OK in \d+ ms/)
  assert.match(result.text, /OK/)
})

test('/opencode rejects an unknown verb', async () => {
  const result = await harness().handler({ rawInput: 'nope' })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /Unknown/)
})
