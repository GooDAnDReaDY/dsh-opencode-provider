#!/usr/bin/env node
/**
 * Verify the plugin against every DSH version listed in
 * dsh.compatibility.dshReleases in an isolated profile.
 *
 * Default mode installs each engine, boots its web host and checks provider
 * activation plus the live catalog. --install-only stops after installation.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const installOnly = process.argv.includes('--install-only')
const requested = process.argv.find((arg) => arg.startsWith('--versions='))?.slice('--versions='.length)
const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const versions = requested
  ? requested.split(',').map((value) => value.trim()).filter(Boolean)
  : Object.keys(pkg.dsh?.compatibility?.dshReleases ?? {})
if (versions.length === 0) throw new Error('no DSH versions configured')

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const shell = process.platform === 'win32'
const pack = spawnSync(npm, ['pack', '--json'], { encoding: 'utf8', shell })
if (pack.status !== 0) throw new Error(`npm pack failed\n${pack.stderr || pack.stdout}`)
const packed = JSON.parse(pack.stdout)
const tgz = join(process.cwd(), packed[0].filename)
const tgzSpec = pathToFileURL(tgz).href
const tempRoots = []

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell, ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  }
  return result
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(getLog, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const match = getLog().match(/dsh web: http:\/\/127\.0\.0\.1:(\d+)\/\S+/)
    if (match) return Number(match[1])
    await sleep(300)
  }
  throw new Error('host did not become ready')
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  for (let i = 0; i < 20; i += 1) {
    if (child.exitCode !== null) return
    await sleep(100)
  }
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGKILL')
  }
}

try {
  for (const version of versions) {
    const root = await mkdtemp(join(tmpdir(), `dsh-opencode-engine-${version.replace(/[^a-z0-9.-]/gi, '_')}-`))
    tempRoots.push(root)
    const cli = join(root, 'cli')
    const home = join(root, 'home')
    const profile = join(home, 'profiles', 'web')
    console.log(`== DSH ${version} ==`)
    run(npm, ['init', '-y'], { cwd: root })
    run(npm, ['install', '--silent', '--prefix', cli, `@deepseek-ai/dsh@${version}`])
    const dshBin = join(cli, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const env = { ...process.env, DSH_HOME: home }
    run(process.execPath, [
      dshBin, 'plugin', '--profile', 'web', 'add',
      `@deepseek-ai/dsh-base@${version}`,
      `@deepseek-ai/dsh-web-app@${version}`,
      tgzSpec,
    ], { env, shell: false })

    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.dsh = manifest.dsh ?? {}
    manifest.dsh.profile = manifest.dsh.profile ?? {}
    manifest.dsh.profile.bundles = [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@goodandready/dsh-opencode-provider',
    ]
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
    const installed = JSON.parse(await readFile(
      join(profile, 'node_modules', '@goodandready', 'dsh-opencode-provider', 'package.json'),
      'utf8',
    ))
    if (installed.version !== pkg.version) {
      throw new Error(`installed ${installed.version}, expected ${pkg.version}`)
    }
    console.log(`install ok: ${installed.version}`)
    if (installOnly) continue

    let log = ''
    const child = spawn(process.execPath, [dshBin, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => { log += String(chunk) })
    child.stderr.on('data', (chunk) => { log += String(chunk) })
    try {
      const port = await waitForPort(() => log)
      const health = await fetch(`http://127.0.0.1:${port}/dsh-opencode/health`)
      if (!health.ok) throw new Error(`health HTTP ${health.status}\n${log}`)
      const healthBody = await health.json()
      const providers = healthBody.providers ?? []
      if (!providers.includes('opencode-direct') || !providers.includes('opencode-go-direct')) {
        throw new Error(`providers missing: ${JSON.stringify(providers)}\n${log}`)
      }
      const state = await fetch(`http://127.0.0.1:${port}/dsh-opencode/state`)
      if (!state.ok) throw new Error(`state HTTP ${state.status}\n${log}`)
      const stateBody = await state.json()
      const models = Array.isArray(stateBody.models) ? stateBody.models.length : 0
      if (models === 0) throw new Error(`live catalog is empty\n${log}`)
      console.log(`activation ok: providers=${providers.join(',')} models=${models}`)
    } finally {
      await stop(child)
    }
  }
  console.log(`engine matrix ok: ${versions.join(', ')}${installOnly ? ' (install only)' : ''}`)
} finally {
  await rm(tgz, { force: true }).catch(() => {})
  for (const root of tempRoots) await rm(root, { recursive: true, force: true }).catch(() => {})
}
