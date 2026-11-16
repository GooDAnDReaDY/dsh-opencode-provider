import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

import {
  installExact,
  isNewerVersion,
  isTrustedReadRequest,
  isTrustedUpdateRequest,
  latestVersion,
  registerPluginUpdater,
  type UpdaterRuntime,
} from '../src/plugin-updater.ts'

test('compares release and prerelease versions', () => {
  assert.equal(isNewerVersion('0.5.0', '0.5.1'), true)
  assert.equal(isNewerVersion('0.5.0', '0.5.0'), false)
  assert.equal(isNewerVersion('0.5.1', '0.5.0'), false)
  assert.equal(isNewerVersion('0.5.0-rc.1', '0.5.0'), true)
  assert.equal(isNewerVersion('0.5.0', '0.5.0-rc.1'), false)
})

test('accepts only a loopback same-origin update request', () => {
  const headers = {
    'x-dsh-plugin-update': '1',
    'sec-fetch-site': 'same-origin',
    origin: 'http://127.0.0.1:3080',
    host: '127.0.0.1:3080',
  }
  assert.equal(isTrustedUpdateRequest({ headers, socket: { remoteAddress: '127.0.0.1' } }), true)
  assert.equal(isTrustedUpdateRequest({ headers, socket: { remoteAddress: '10.0.0.5' } }), false)
  assert.equal(isTrustedUpdateRequest({
    headers: { ...headers, origin: 'http://evil.example:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)
  assert.equal(isTrustedUpdateRequest({
    headers: { ...headers, 'x-dsh-plugin-update': '0' },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)
})

test('accepts loopback and local interface update status reads', () => {
  assert.equal(isTrustedReadRequest({
    headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'same-origin' },
    socket: { remoteAddress: '127.0.0.1' },
  }), true)
  assert.equal(isTrustedReadRequest({
    headers: { host: 'evil.example:3080', origin: 'http://evil.example:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)
  assert.equal(isTrustedReadRequest({
    headers: { host: '127.0.0.1:3080', origin: 'http://evil.example:3080' },
    socket: { remoteAddress: '127.0.0.1' },
  }), false)
  const ip = Object.values(networkInterfaces()).flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address
  if (ip !== undefined) {
    assert.equal(isTrustedReadRequest({
      headers: { host: `${ip}:3080`, origin: `http://${ip}:3080`, 'sec-fetch-site': 'same-origin' },
      socket: { remoteAddress: '10.0.0.5' },
    }), true)
  }
})

function fakeSpawn(outcome: { code?: number | null; stderr?: string; error?: Error }) {
  const calls: Array<{ command: string; args: string[]; cwd?: unknown }> = []
  const impl = ((command: string, args: string[], options?: { cwd?: unknown }) => {
    calls.push({ command, args, cwd: options?.cwd })
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: () => void
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {}
    queueMicrotask(() => {
      if (outcome.stderr !== undefined) child.stderr.emit('data', outcome.stderr)
      if (outcome.error !== undefined) child.emit('error', outcome.error)
      else child.emit('exit', outcome.code ?? 0)
    })
    return child
  }) as unknown as typeof import('node:child_process').spawn
  return { impl, calls }
}

test('latestVersion reads the registry once and caches the result', async () => {
  const packageName = `probe-${Date.now()}-${Math.random()}`
  let calls = 0
  const fetchImpl = (async () => {
    calls += 1
    return new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })
  }) as typeof fetch

  assert.equal(await latestVersion(packageName, 'https://registry.example', fetchImpl), '9.9.9')
  assert.equal(await latestVersion(packageName, 'https://registry.example', fetchImpl), '9.9.9')
  assert.equal(calls, 1)
})

test('latestVersion fails open on registry errors and malformed bodies', async () => {
  const name = () => `probe-${Date.now()}-${Math.random()}`
  const notOk = (async () => new Response('nope', { status: 503 })) as typeof fetch
  assert.equal(await latestVersion(name(), 'https://r.example', notOk), undefined)

  const malformed = (async () => new Response(JSON.stringify({ version: 42 }), { status: 200 })) as typeof fetch
  assert.equal(await latestVersion(name(), 'https://r.example', malformed), undefined)

  const throwing = (async () => { throw new Error('offline') }) as typeof fetch
  assert.equal(await latestVersion(name(), 'https://r.example', throwing), undefined)
})

test('installExact spawns the DSH CLI with the exact version and registry', async () => {
  const { impl, calls } = fakeSpawn({ code: 0 })
  const target: UpdaterRuntime = { profileName: 'web', profileDir: '/profiles/web', cliEntry: '/cli/bin.js' }
  await installExact(target, '@scope/pkg@0.5.46', { registry: 'https://registry.example', spawnImpl: impl })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0]?.args, [
    '/cli/bin.js', 'plugin', '--profile', 'web', 'add',
    '@scope/pkg@0.5.46', '--registry=https://registry.example',
  ])
  assert.equal(calls[0]?.cwd, '/profiles/web')
})

test('installExact surfaces a failed install and a spawn error', async () => {
  const { impl } = fakeSpawn({ code: 1, stderr: 'registry refused' })
  const target: UpdaterRuntime = { profileName: 'web', profileDir: '/p', cliEntry: '/cli.js' }
  await assert.rejects(
    installExact(target, 'pkg@1.0.1', { spawnImpl: impl }),
    /registry refused/,
  )

  const broken = fakeSpawn({ error: new Error('spawn ENOENT') })
  await assert.rejects(
    installExact(target, 'pkg@1.0.1', { spawnImpl: broken.impl }),
    /spawn ENOENT/,
  )

  await assert.rejects(
    installExact({ profileName: 'web', profileDir: '/p' }, 'pkg@1.0.1', {}),
    /unavailable/,
  )
})

function updaterHarness(manifestVersion: string, registryVersion: string) {
  const dir = mkdtempSync(join(process.env.TEMP ?? '/tmp', 'dsh-updater-'))
  const manifest = join(dir, 'package.json')
  writeFileSync(manifest, JSON.stringify({ version: manifestVersion }))
  const warnings: string[] = []
  let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined

  const ctx = {
    logger: () => ({ warn: (message: string) => { warnings.push(message) } }),
    webServer: {
      register: (route: { handler: (req: unknown, res: unknown) => Promise<void> }) => {
        handler = route.handler
        return () => {}
      },
    },
  }
  registerPluginUpdater(ctx as never, {
    endpoint: '/dsh-opencode/update',
    packageName: `probe-${Date.now()}-${Math.random()}`,
    manifestUrl: pathToFileURL(manifest),
    fetchImpl: (async () => new Response(JSON.stringify({ version: registryVersion }), { status: 200 })) as typeof fetch,
    adminToken: () => '',
  })

  const call = async (options: { method?: string; headers?: Record<string, string> } = {}) => {
    const captured = { status: 0, body: '' }
    const req = {
      method: options.method ?? 'GET',
      headers: {
        host: '127.0.0.1:3080',
        origin: 'http://127.0.0.1:3080',
        'sec-fetch-site': 'same-origin',
        ...(options.headers ?? {}),
      },
      socket: { remoteAddress: '127.0.0.1' },
    }
    const res = {
      writeHead: (status: number) => { captured.status = status },
      end: (body?: string) => { captured.body = body ?? '' },
    }
    await handler?.(req, res)
    return captured
  }

  return { call, warnings, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('updater status reports the version difference from the registry', async () => {
  const newer = updaterHarness('0.5.45', '0.5.46')
  const result = await newer.call()
  assert.equal(result.status, 200)
  const body = JSON.parse(result.body) as Record<string, unknown>
  assert.equal(body.currentVersion, '0.5.45')
  assert.equal(body.latestVersion, '0.5.46')
  assert.equal(body.updateAvailable, true)
  assert.equal(body.latestCheckFailed, false)
  newer.cleanup()

  const same = updaterHarness('0.5.46', '0.5.46')
  const sameBody = JSON.parse((await same.call()).body) as Record<string, unknown>
  assert.equal(sameBody.updateAvailable, false)
  same.cleanup()
})

test('updater endpoint enforces method and the update header', async () => {
  const harness = updaterHarness('0.5.45', '0.5.46')
  assert.equal((await harness.call({ method: 'PUT' })).status, 405)

  const missingHeader = await harness.call({ method: 'POST' })
  assert.equal(missingHeader.status, 403)

  const crossOrigin = await harness.call({
    method: 'POST',
    headers: { 'x-dsh-plugin-update': '1', origin: 'http://evil.example:3080' },
  })
  assert.equal(crossOrigin.status, 403)
  harness.cleanup()
})
