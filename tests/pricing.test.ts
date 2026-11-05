import assert from 'node:assert/strict'
import test from 'node:test'

import { parseGatewayPricing, priceUsage } from '../src/pricing.ts'

const cost = {
  text: {
    input: { price: 1, cache: { read: 0.1 }, overrides: [{ when: { context: { gt: 200_000 } }, price: 4, cache: { read: 0.4 } }] },
    output: { price: 2, overrides: [{ when: { context: { gt: 200_000 } }, price: 8 }] },
  },
  multipliers: [{
    when: {
      utc_days: { in: ['mon', 'tue', 'wed', 'thu', 'fri'] },
      any: [
        { all: [{ utc_hours: { gte: '01:00' } }, { utc_hours: { lt: '04:00' } }] },
        { all: [{ utc_hours: { gte: '06:00' } }, { utc_hours: { lt: '10:00' } }] },
      ],
    },
    factor: 2,
  }],
}

test('prices context tiers and UTC peak multipliers', () => {
  const pricing = parseGatewayPricing(cost)
  assert.ok(pricing)
  const mondayPeak = Date.parse('2026-11-02T02:00:00Z')
  const mondayOffPeak = Date.parse('2026-11-02T00:30:00Z')

  const small = priceUsage(pricing, { input: 100_000, output: 1_000, cacheRead: 0 }, mondayOffPeak)
  assert.equal(small, 0.102)

  const peak = priceUsage(pricing, { input: 100_000, output: 1_000, cacheRead: 0 }, mondayPeak)
  assert.equal(peak, 0.204)

  const tiered = priceUsage(pricing, { input: 300_000, output: 1_000, cacheRead: 0 }, mondayOffPeak)
  assert.equal(tiered, 1.208)

  const boundary = priceUsage(pricing, { input: 200_000, output: 1_000, cacheRead: 0 }, mondayOffPeak)
  assert.equal(boundary, 0.202)
})

test('rejects malformed gateway pricing metadata', () => {
  assert.equal(parseGatewayPricing({ text: { input: { price: -1 }, output: { price: 2 } } }), undefined)
  assert.equal(parseGatewayPricing({ text: { input: { price: 1 } } }), undefined)
  assert.equal(parseGatewayPricing({ text: { input: { price: 1 }, output: { price: 2 } }, multipliers: [{ factor: 0, when: { utc_days: { in: ['mon'] } } }] })?.multipliers.length, 0)
})
