import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  addManagedCredentialRef,
  removeManagedCredentialRef,
  readManagedCredentialRefs,
  ManagedCredentialsCorruptError,
} from '../src/managed-credentials.ts'

test('concurrent writes do not corrupt managed credential registry', async () => {
  const testPath = join(tmpdir(), `test-managed-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  try {
    const promises: Promise<void>[] = []
    // 12 concurrent adds
    for (let i = 0; i < 12; i++) {
      promises.push(addManagedCredentialRef(`ref-${i}`, testPath))
    }
    await Promise.all(promises)

    let refs = await readManagedCredentialRefs(testPath)
    assert.equal(refs.size, 12)
    for (let i = 0; i < 12; i++) {
      assert.equal(refs.has(`ref-${i}`), true)
    }

    // 4 concurrent removes
    const removePromises: Promise<void>[] = []
    for (let i = 0; i < 4; i++) {
      removePromises.push(removeManagedCredentialRef(`ref-${i}`, testPath))
    }
    await Promise.all(removePromises)

    refs = await readManagedCredentialRefs(testPath)
    assert.equal(refs.size, 8)
    for (let i = 0; i < 4; i++) {
      assert.equal(refs.has(`ref-${i}`), false)
    }
    for (let i = 4; i < 12; i++) {
      assert.equal(refs.has(`ref-${i}`), true)
    }
  } finally {
    await rm(testPath, { force: true }).catch(() => {})
  }
})

test('malformed managed credentials file throws ManagedCredentialsCorruptError', async () => {
  const testPath = join(tmpdir(), `test-managed-corrupt-${Date.now()}.json`)
  try {
    await writeFile(testPath, '{"refs": [invalid json', 'utf8')
    await assert.rejects(
      async () => {
        await readManagedCredentialRefs(testPath)
      },
      ManagedCredentialsCorruptError,
    )
  } finally {
    await rm(testPath, { force: true }).catch(() => {})
  }
})
