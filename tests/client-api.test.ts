import assert from 'node:assert/strict'
import test, { after, beforeEach } from 'node:test'

import {
  ApiError,
  fetchState,
  fetchUpdate,
  installUpdate,
  saveConfig,
  saveKey,
} from '../src/client/api.ts'
import { getAdminToken, setAdminToken } from '../src/client/admin-token.ts'

const originalFetch = globalThis.fetch
const originalStorage = (globalThis as { sessionStorage?: unknown }).sessionStorage

class MemoryStorage {
  private readonly store = new Map<string, string>()
  get length(): number { return this.store.size }
  clear(): void { this.store.clear() }
  getItem(key: string): string | null { return this.store.get(key) ?? null }
  key(index: number): string | null { return [...this.store.keys()][index] ?? null }
  removeItem(key: string): void { this.store.delete(key) }
  setItem(key: string, value: string): void { this.store.set(key, value) }
}

const requests: Array<{ url: string; init?: RequestInit | undefined }> = []
let responseFactory: () => Response = () => new Response('{}', { status: 200 })

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  requests.push({ url: String(input), init })
  return responseFactory()
}) as typeof fetch

beforeEach(() => {
  requests.length = 0
  responseFactory = () => new Response('{}', { status: 200 })
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = new MemoryStorage()
})

after(() => {
  globalThis.fetch = originalFetch
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = originalStorage
})

function headersOf(index = 0): Record<string, string> {
  return (requests[index]?.init?.headers ?? {}) as Record<string, string>
}

test('the admin token is sent only when configured', async () => {
  await fetchState()
  assert.equal(headersOf()['x-opencode-token'], undefined)

  setAdminToken('  token-123  ')
  assert.equal(getAdminToken(), 'token-123')
  await fetchState()
  assert.equal(headersOf(1)['x-opencode-token'], 'token-123')

  setAdminToken('')
  assert.equal(getAdminToken(), '')
  await fetchState()
  assert.equal(headersOf(2)['x-opencode-token'], undefined)
})

test('API errors keep the machine-readable code and status', async () => {
  responseFactory = () => new Response(
    JSON.stringify({ error: 'settings revision conflict', code: 'SETTINGS_CONFLICT' }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  )

  await assert.rejects(fetchState(), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 409)
    assert.equal(error.code, 'SETTINGS_CONFLICT')
    assert.equal(error.message, 'settings revision conflict')
    return true
  })
})

test('a non-JSON failure does not leak the response body', async () => {
  responseFactory = () => new Response('gateway stack trace', { status: 500 })

  await assert.rejects(fetchState(), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.status, 500)
    assert.equal(error.code, undefined)
    assert.equal(error.message, 'HTTP 500')
    return true
  })
})

test('saveConfig sends the draft revision with the patch', async () => {
  await saveConfig({ maxTools: 200 }, 7)
  assert.equal(requests[0]?.url, '/dsh-opencode/config')
  assert.equal(requests[0]?.init?.method, 'POST')
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    patch: { maxTools: 200 },
    revision: 7,
  })
  assert.equal(headersOf()['content-type'], 'application/json')
})

test('writes and the updater carry their protocol headers', async () => {
  await saveKey('OPENCODE_API_KEY_2', 'oc_sk_test')
  assert.equal(requests[0]?.url, '/dsh-opencode/key')
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    ref: 'OPENCODE_API_KEY_2',
    key: 'oc_sk_test',
  })

  await installUpdate()
  assert.equal(requests[1]?.url, '/dsh-opencode/update')
  assert.equal(requests[1]?.init?.method, 'POST')
  assert.equal(headersOf(1)['x-dsh-plugin-update'], '1')

  await fetchUpdate()
  assert.equal(requests[2]?.url, '/dsh-opencode/update')
  assert.equal(requests[2]?.init?.method, undefined)
})
