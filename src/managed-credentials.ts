import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const REF_LIMIT = 128

export class ManagedCredentialsCorruptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ManagedCredentialsCorruptError'
  }
}

export function managedCredentialsPath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-opencode', 'managed-credentials.json')
}

function validRef(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= REF_LIMIT
}

const fileLocks = new Map<string, Promise<unknown>>()

function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const current = fileLocks.get(path) ?? Promise.resolve()
  const next = current.then(fn, fn)
  fileLocks.set(path, next)
  return next
}

async function readRefs(path: string): Promise<Set<string>> {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ENOENT') {
      return new Set()
    }
    throw error
  }
  try {
    const parsed = JSON.parse(content) as { refs?: unknown }
    if (!Array.isArray(parsed.refs)) {
      throw new ManagedCredentialsCorruptError(`Invalid format in ${path}: "refs" must be an array`)
    }
    return new Set(parsed.refs.filter(validRef))
  } catch (error) {
    if (error instanceof ManagedCredentialsCorruptError) throw error
    throw new ManagedCredentialsCorruptError(`Failed to parse managed credentials file at ${path}`, { cause: error })
  }
}

async function writeRefs(path: string, refs: Set<string>): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tmpPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  const data = JSON.stringify({ refs: [...refs].sort() })
  await writeFile(tmpPath, data, 'utf8')
  await rename(tmpPath, path)
}

export async function readManagedCredentialRefs(path = managedCredentialsPath()): Promise<Set<string>> {
  return withFileLock(path, () => readRefs(path))
}

async function mutate(path: string, ref: string, add: boolean): Promise<void> {
  if (!validRef(ref)) return
  await withFileLock(path, async () => {
    const refs = await readRefs(path)
    if (add) refs.add(ref)
    else refs.delete(ref)
    await writeRefs(path, refs)
  })
}

export async function addManagedCredentialRef(ref: string, path = managedCredentialsPath()): Promise<void> {
  await mutate(path, ref, true)
}

export async function removeManagedCredentialRef(ref: string, path = managedCredentialsPath()): Promise<void> {
  await mutate(path, ref, false)
}
