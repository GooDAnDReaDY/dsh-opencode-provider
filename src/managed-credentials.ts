import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const REF_LIMIT = 128

export function managedCredentialsPath(): string {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'storages', 'dsh-opencode', 'managed-credentials.json')
}

function validRef(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= REF_LIMIT
}

async function readRefs(path: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { refs?: unknown }
    if (!Array.isArray(parsed.refs)) return new Set()
    return new Set(parsed.refs.filter(validRef))
  } catch {
    return new Set()
  }
}

async function writeRefs(path: string, refs: Set<string>): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify({ refs: [...refs].sort() }), 'utf8')
}

export async function readManagedCredentialRefs(path = managedCredentialsPath()): Promise<Set<string>> {
  return readRefs(path)
}

async function mutate(path: string, ref: string, add: boolean): Promise<void> {
  if (!validRef(ref)) return
  const refs = await readRefs(path)
  if (add) refs.add(ref)
  else refs.delete(ref)
  await writeRefs(path, refs)
}

export async function addManagedCredentialRef(ref: string, path = managedCredentialsPath()): Promise<void> {
  await mutate(path, ref, true)
}

export async function removeManagedCredentialRef(ref: string, path = managedCredentialsPath()): Promise<void> {
  await mutate(path, ref, false)
}
