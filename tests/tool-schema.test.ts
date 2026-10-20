import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeToolParameters } from '../src/tool-schema.ts'

test('keeps an object root untouched', () => {
  const schema = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
  assert.equal(normalizeToolParameters(schema), schema)
})

test('adds a type to a type-less object-shaped schema', () => {
  const normalized = normalizeToolParameters({
    properties: { q: { type: 'string' } },
    required: ['q'],
    additionalProperties: false,
  })
  assert.deepEqual(normalized, {
    type: 'object',
    properties: { q: { type: 'string' } },
    required: ['q'],
    additionalProperties: false,
  })
})

test('resolves a local root $ref', () => {
  const normalized = normalizeToolParameters({
    $ref: '#/$defs/args',
    $defs: {
      args: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    description: 'kept',
  })
  assert.equal(normalized.type, 'object')
  assert.deepEqual(normalized.properties, { id: { type: 'string' } })
  assert.deepEqual(normalized.required, ['id'])
  assert.equal(normalized.description, 'kept')
})

test('merges allOf branches into one object', () => {
  const normalized = normalizeToolParameters({
    allOf: [
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
    ],
  })
  assert.equal(normalized.type, 'object')
  assert.deepEqual(Object.keys(normalized.properties as object).sort(), ['a', 'b'])
  assert.deepEqual((normalized.required as string[]).sort(), ['a', 'b'])
})

test('degrades a non-object root to a permissive object', () => {
  assert.deepEqual(normalizeToolParameters({ type: 'array', items: { type: 'string' } }), {
    type: 'object',
    properties: {},
    additionalProperties: true,
  })
  assert.deepEqual(normalizeToolParameters(undefined), {
    type: 'object',
    properties: {},
    additionalProperties: true,
  })
})

test('normalizes a type union containing object', () => {
  const normalized = normalizeToolParameters({
    type: ['object', 'null'],
    properties: { a: { type: 'string' } },
  })
  assert.equal(normalized.type, 'object')
  assert.deepEqual(normalized.properties, { a: { type: 'string' } })
})
