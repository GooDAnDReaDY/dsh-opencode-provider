import assert from 'node:assert/strict'
import test from 'node:test'

import { isNewerVersion, isTrustedUpdateRequest } from '../src/plugin-updater.ts'

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
