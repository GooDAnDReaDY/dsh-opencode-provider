import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'

import { limitTools } from '../src/tools.ts'

function tool(name: string): ToolSchema {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
  } as ToolSchema
}

test('caps tools at the OpenCode limit', () => {
  const tools = Array.from({ length: 140 }, (_, index) => tool(`tool-${index}`))
  const limited = limitTools(tools)
  assert.equal(limited?.length, 128)
  assert.equal(limited?.[0]?.name, 'tool-0')
  assert.equal(limited?.[127]?.name, 'tool-127')
})

test('deduplicates tools by name before capping', () => {
  const tools = [tool('read'), tool('read'), tool('write'), tool('read')]
  const limited = limitTools(tools)
  assert.deepEqual(limited?.map((entry) => entry.name), ['read', 'write'])
})

test('leaves a small unique list in order', () => {
  const tools = [tool('read'), tool('write')]
  assert.deepEqual(limitTools(tools)?.map((entry) => entry.name), ['read', 'write'])
  assert.equal(limitTools(undefined), undefined)
  assert.deepEqual(limitTools([]), [])
})

test('keeps core tools when a large MCP set hits the cap', () => {
  const tools = Array.from({ length: 130 }, (_, index) => tool(`mcp-${index}`))
  tools.push(tool('read'))
  const limited = limitTools(tools)
  assert.equal(limited?.length, 128)
  assert.equal(limited?.[0]?.name, 'read')
})
