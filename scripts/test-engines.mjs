#!/usr/bin/env node
/**
 * Validate one immutable package candidate against the declared DSH matrix.
 *
 * This script never installs DSH, never starts a runtime, never extracts a
 * candidate, and never touches another profile or plugin. The compatibility
 * run itself belongs to the approved MiniPC test contour; this command only
 * proves that a published candidate declares a supported matrix and contains
 * the expected production files.
 */
import { execFileSync } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'

const REQUIRED_FILES = [
  'package/package.json',
  'package/lib/index.js',
  'package/lib/index.d.ts',
  'package/lib/client.js',
]
const FORBIDDEN_PREFIXES = ['package/src/', 'package/tests/', 'package/scripts/', 'package/.git/']

export function normalizeRange(range) {
  return typeof range === 'string' ? range.trim() : ''
}

export function validateManifest(manifest, files) {
  const errors = []
  if (manifest?.name !== '@goodandready/dsh-opencode-provider') errors.push('unexpected package name')
  if (typeof manifest?.version !== 'string' || manifest.version === '') errors.push('missing version')
  else if (!semver.valid(manifest.version)) errors.push(`invalid package version: ${manifest.version}`)

  const range = normalizeRange(manifest?.engines?.dsh)
  if (range === '') {
    errors.push('engines.dsh is missing')
  } else if (!semver.validRange(range)) {
    errors.push(`invalid engines.dsh semver range: ${range}`)
  }

  const dshCompatRange = normalizeRange(manifest?.dsh?.compatibility?.dsh)
  if (dshCompatRange !== '' && !semver.validRange(dshCompatRange)) {
    errors.push(`invalid dsh.compatibility.dsh semver range: ${dshCompatRange}`)
  }

  const releases = manifest?.dsh?.compatibility?.dshReleases
  if (typeof releases !== 'object' || releases === null || Array.isArray(releases)) {
    errors.push('dsh.compatibility.dshReleases is missing')
  } else if (Object.keys(releases).length === 0) {
    errors.push('dsh.compatibility.dshReleases is empty')
  } else {
    for (const [ver, status] of Object.entries(releases)) {
      if (!semver.valid(ver)) {
        errors.push(`invalid semver version in dshReleases: ${ver}`)
        continue
      }
      if (status === 'compatible') {
        if (range !== '' && semver.validRange(range) && !semver.satisfies(ver, range, { includePrerelease: true })) {
          errors.push(`declared release ${ver} does not satisfy engines.dsh range ${range}`)
        }
        if (manifest?.peerDependencies && typeof manifest.peerDependencies === 'object') {
          for (const [peerPkg, peerRange] of Object.entries(manifest.peerDependencies)) {
            if (peerPkg.startsWith('@deepseek-ai/dsh-') && typeof peerRange === 'string') {
              if (semver.validRange(peerRange) && !semver.satisfies(ver, peerRange, { includePrerelease: true })) {
                errors.push(`declared release ${ver} does not satisfy peerDependency range for ${peerPkg}: ${peerRange}`)
              }
            }
          }
        }
      }
    }
  }

  const listed = new Set(files)
  for (const required of REQUIRED_FILES) {
    if (!listed.has(required)) errors.push(`missing ${required}`)
  }
  for (const file of files) {
    if (FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      errors.push(`forbidden package content ${file}`)
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    version: manifest?.version,
    range,
    releases: releases ?? {},
  }
}

export function inspectTarball(file) {
  const listing = execFileSync('tar', ['-tzf', file], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((line) => line !== '')
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', file, 'package/package.json'], { encoding: 'utf8' }))
  return { ...validateManifest(manifest, listing), files: listing }
}

async function main() {
  const file = process.argv[2]
  if (file === undefined || file === '') {
    console.error('usage: npm run test:engine -- <candidate.tgz>')
    process.exitCode = 2
    return
  }
  const absolute = path.resolve(file)
  const info = await stat(absolute).catch(() => undefined)
  if (info === undefined || !info.isFile()) throw new Error(`candidate is not a readable file: ${absolute}`)
  const result = inspectTarball(absolute)
  if (!result.ok) {
    console.error(`candidate ${result.version ?? '?'} failed the DSH matrix:\n${result.errors.join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log(`candidate ${result.version} · dsh ${result.range} · ${Object.keys(result.releases).length} declared releases`)
  for (const [version, status] of Object.entries(result.releases)) console.log(`  ${version}: ${status}`)
  console.log('candidate contents are production-only; no install, no runtime, no cleanup required')
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
