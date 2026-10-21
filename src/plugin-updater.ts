import type { Context } from '@deepseek-ai/cordis'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Host-side one-click updater for a DSH Web plugin.
 *
 * Mount from apply():
 *
 * registerPluginUpdater(ctx, {
 *   endpoint: '/api/<namespace>/update',
 *   packageName: '@goodandready/<package>',
 *   manifestUrl: new URL('../package.json', import.meta.url),
 *   // registry: 'https://npm.pkg.github.com', // private package only
 * })
 *
 * GET returns status. POST is accepted only from the local same-origin UI and
 * installs the exact registry version through the normal DSH CLI. No force
 * flags, raw shell strings, worktree paths, or delete-before-install steps.
 */

type Request = {
  method?: string | undefined
  headers?: Record<string, string | string[] | undefined> | undefined
  socket?: { remoteAddress?: string | undefined } | undefined
}

type Response = {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

type WebServer = {
  register(route: {
    kind: 'exact'
    path: string
    handler(request: Request, response: Response): Promise<void>
  }): () => void
}

type UpdaterContext = Context & { webServer: WebServer }

export type PluginUpdaterOptions = {
  readonly endpoint: string
  readonly packageName: string
  readonly manifestUrl: URL
  readonly registry?: string
}

type Runtime = {
  readonly profileName: string
  readonly profileDir: string
  readonly cliEntry?: string
}

type VersionPayload = {
  packageName: string
  currentVersion: string
  latestVersion?: string
  latestCheckFailed: boolean
  updateAvailable: boolean
  profileName: string
  canAutoUpdate: boolean
}

const UPDATE_HEADER = 'x-dsh-plugin-update'
const UPDATE_TIMEOUT_MS = 10 * 60_000
const VERSION_CACHE_MS = 5 * 60_000
let latestCache: { packageName: string; registry: string; version: string; expiresAt: number } | undefined

function header(request: Request, name: string): string | undefined {
  const value = request.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

function isLoopback(value: string | undefined): boolean {
  const address = value?.toLowerCase().replace(/^\[|\]$/g, '')
  return address === 'localhost' || address === 'localhost.' || address === '::1'
    || address?.startsWith('127.') === true
    || address?.startsWith('::ffff:127.') === true
}

export function isTrustedUpdateRequest(request: Request): boolean {
  if (header(request, UPDATE_HEADER) !== '1') return false
  if (!isLoopback(request.socket?.remoteAddress)) return false
  const site = header(request, 'sec-fetch-site')
  if (site !== undefined && site !== 'same-origin') return false
  const origin = header(request, 'origin')
  const host = header(request, 'host')
  if (origin === undefined || host === undefined) return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && isLoopback(url.hostname) && url.host === host
  } catch {
    return false
  }
}

/** Local, loopback-only reads for the update card; blocks DNS-rebinding hosts. */
export function isTrustedReadRequest(request: Request): boolean {
  if (!isLoopback(request.socket?.remoteAddress)) return false
  const host = header(request, 'host')
  if (host === undefined) return false
  try {
    const hostUrl = new URL(`http://${host}`)
    if (!isLoopback(hostUrl.hostname)) return false
  } catch {
    return false
  }
  const site = header(request, 'sec-fetch-site')
  if (site !== undefined && site !== 'same-origin') return false
  const origin = header(request, 'origin')
  if (origin === undefined) return true
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && isLoopback(url.hostname) && url.host === host
  } catch {
    return false
  }
}

function validProfileName(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value !== '.' && value !== '..'
    && !value.includes('/') && !value.includes('\\') && !/[\0-\x1f\x7f]/.test(value)
}

function profileNameFromArgv(argv: readonly string[]): string | undefined {
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--profile') return argv[index + 1]
    if (argv[index]?.startsWith('--profile=')) return argv[index]!.slice('--profile='.length)
  }
  return argv[2] === 'web' ? 'web' : undefined
}

function findDshCliEntry(): string | undefined {
  const candidates = new Set<string>()
  const fromArgv = process.argv[1]
  if (fromArgv !== undefined && fromArgv !== '') {
    candidates.add(fromArgv.startsWith('file:') ? fileURLToPath(fromArgv) : resolve(process.cwd(), fromArgv))
  }
  // The desktop host passes the extracted DSH package root as an argument.
  for (const value of process.argv.slice(2)) {
    if (/[\\/](?:app\.asar[\\/])?dsh[\\/]?$/i.test(value)) candidates.add(resolve(value))
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    let entry = candidate
    try {
      if (statSync(candidate).isDirectory()) entry = resolve(candidate, 'package.json')
    } catch {
      continue
    }
    for (let directory = dirname(entry); ; directory = dirname(directory)) {
      const manifestPaths = [
        resolve(directory, 'package.json'),
        resolve(directory, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
      ]
      for (const manifestPath of manifestPaths) {
        if (!existsSync(manifestPath)) continue
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; bin?: unknown }
          const bin = typeof manifest.bin === 'string'
            ? manifest.bin
            : typeof manifest.bin === 'object' && manifest.bin !== null
              ? (manifest.bin as { dsh?: unknown }).dsh
              : undefined
          if (manifest.name === '@deepseek-ai/dsh' && typeof bin === 'string' && !isAbsolute(bin)) {
            const cli = resolve(dirname(manifestPath), bin)
            if (existsSync(cli)) return cli
          }
        } catch {
          // Continue searching parent package directories.
        }
      }
      const parent = dirname(directory)
      if (parent === directory) break
    }
  }
  return undefined
}

function profileFromArgv(argv: readonly string[]): { dir: string; name: string } | undefined {
  for (const value of argv) {
    const match = /[\\/]\.dsh[\\/]profiles[\\/]([^\\/]+)[\\/]?$/i.exec(value)
    if (match !== null && validProfileName(match[1])) {
      return { dir: resolve(value), name: match[1]! }
    }
  }
  return undefined
}

function runtime(): Runtime {
  const fromArgv = profileFromArgv(process.argv)
  const profileDir = resolve(process.env.DSH_PROFILE_DIR
    ?? fromArgv?.dir
    ?? resolve(homedir(), '.dsh', 'profiles', 'web'))
  const selected = process.env.DSH_PROFILE_NAME ?? profileNameFromArgv(process.argv) ?? fromArgv?.name
  const profileName = validProfileName(selected)
    ? selected
    : validProfileName(basename(profileDir)) ? basename(profileDir) : 'web'
  const cliEntry = findDshCliEntry()
  return cliEntry === undefined ? { profileName, profileDir } : { profileName, profileDir, cliEntry }
}

type Semver = { core: readonly [number, number, number]; prerelease: readonly string[] }

function parseSemver(value: string): Semver | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
  if (match === null) return undefined
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  }
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return left.length === right.length ? 0 : left.length === 0 ? 1 : -1
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1
    if (a === b) continue
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) {
      const aNumber = BigInt(a)
      const bNumber = BigInt(b)
      if (aNumber !== bNumber) return aNumber > bNumber ? 1 : -1
      continue
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a > b ? 1 : -1
  }
  return 0
}

export function isNewerVersion(currentValue: string, candidateValue: string): boolean {
  const current = parseSemver(currentValue)
  const candidate = parseSemver(candidateValue)
  if (current === undefined || candidate === undefined) return false
  for (let index = 0; index < 3; index += 1) {
    if (candidate.core[index] !== current.core[index]) return candidate.core[index]! > current.core[index]!
  }
  return comparePrerelease(candidate.prerelease, current.prerelease) > 0
}

async function latestVersion(packageName: string, registry: string): Promise<string | undefined> {
  if (latestCache?.packageName === packageName && latestCache.registry === registry && Date.now() < latestCache.expiresAt) return latestCache.version
  try {
    const response = await fetch(`${registry.replace(/\/$/, '')}/${encodeURIComponent(packageName)}/latest`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) return undefined
    const value = await response.json() as { version?: unknown }
    if (typeof value.version !== 'string' || value.version === '') return undefined
    latestCache = { packageName, registry, version: value.version, expiresAt: Date.now() + VERSION_CACHE_MS }
    return value.version
  } catch {
    return undefined
  }
}

async function currentVersion(manifestUrl: URL): Promise<string> {
  const value = JSON.parse(await readFile(manifestUrl, 'utf8')) as { version?: unknown }
  if (typeof value.version !== 'string' || value.version === '') throw new Error('Cannot read current plugin version.')
  return value.version
}

async function status(options: PluginUpdaterOptions, target: Runtime): Promise<VersionPayload> {
  const current = await currentVersion(options.manifestUrl)
  const latest = await latestVersion(options.packageName, options.registry ?? 'https://registry.npmjs.org')
  return {
    packageName: options.packageName,
    currentVersion: current,
    ...(latest === undefined ? {} : { latestVersion: latest }),
    latestCheckFailed: latest === undefined,
    updateAvailable: latest !== undefined && isNewerVersion(current, latest),
    profileName: target.profileName,
    canAutoUpdate: target.cliEntry !== undefined,
  }
}

async function installExact(target: Runtime, packageSpec: string, options: PluginUpdaterOptions): Promise<void> {
  if (target.cliEntry === undefined) throw new Error('Automatic update is unavailable in this runtime.')
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      target.cliEntry!, 'plugin', '--profile', target.profileName, 'add',
      '--config.minimumReleaseAge=0', packageSpec,
      `--registry=${options.registry ?? 'https://registry.npmjs.org/'}`,
    ], {
      cwd: target.profileDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', ELECTRON_RUN_AS_NODE: '1' },
    })
    let detail = ''
    child.stdout?.on('data', chunk => { detail = (detail + String(chunk)).slice(-4_000) })
    child.stderr?.on('data', chunk => { detail = (detail + String(chunk)).slice(-4_000) })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Update timed out; use the normal DSH update flow.'))
    }, UPDATE_TIMEOUT_MS)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => {
      clearTimeout(timer)
      if (code === 0) resolvePromise()
      else reject(new Error(detail.trim() || `Update exited with code ${String(code)}.`))
    })
  })
}

function json(response: Response, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

export function registerPluginUpdater(ctx: Context, options: PluginUpdaterOptions): () => void {
  const host = ctx as UpdaterContext
  let installing = false
  return host.webServer.register({
    kind: 'exact',
    path: options.endpoint,
    handler: async (request, response) => {
      try {
        const target = runtime()
        if (request.method === 'GET' || request.method === 'HEAD') {
          if (!isTrustedReadRequest(request)) {
            json(response, 403, { error: 'Rejected non-local update status request.' })
            return
          }
          const payload = await status(options, target)
          response.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          response.end(request.method === 'HEAD' ? undefined : JSON.stringify(payload))
          return
        }
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'GET, HEAD, POST' })
          response.end()
          return
        }
        if (!isTrustedUpdateRequest(request)) {
          json(response, 403, { error: 'Rejected non-local or cross-origin update request.' })
          return
        }
        if (installing) {
          json(response, 409, { error: 'This plugin is already updating.' })
          return
        }
        installing = true
        try {
          const before = await status(options, target)
          if (before.latestVersion === undefined) {
            json(response, 503, { error: 'The latest version is temporarily unavailable.' })
            return
          }
          if (!before.updateAvailable) {
            json(response, 200, before)
            return
          }
          await installExact(target, `${options.packageName}@${before.latestVersion}`, options)
          json(response, 200, {
            ...before,
            updatedVersion: before.latestVersion,
            restartRequired: true,
          })
        } finally {
          installing = false
        }
      } catch (error) {
        ctx.logger('llm-opencode').warn(`plugin updater failed: ${String(error)}`)
        json(response, 503, { error: 'Plugin update failed; see server logs.' })
      }
    },
  })
}
