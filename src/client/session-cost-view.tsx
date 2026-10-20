import type { ReactNode } from 'react'

import type { OpenCodeCostFacts } from '../cost-facts.ts'
import { buildFactsCost, buildSessionCost, type SessionSelectionProjection, type SessionUsageBuckets } from './session-cost.ts'

interface ProjectionSeats {
  tokenUsage: SessionUsageBuckets
  modelSelection: SessionSelectionProjection
  opencodeCost: OpenCodeCostFacts
}

export interface UseProjectionLike {
  <K extends keyof ProjectionSeats>(key: K): ProjectionSeats[K] | undefined
}

/**
 * The composer-dock contribution. It renders a compact estimate beside the
 * harness's own token readout and nothing else; the calculation is local
 * because the price snapshot ships with the bundle.
 */
export function OpenCodeSessionCost(props: { useProjection?: UseProjectionLike }): ReactNode {
  if (typeof props.useProjection !== 'function') return null
  const usage = props.useProjection('tokenUsage')
  const selection = props.useProjection('modelSelection')
  const facts = props.useProjection('opencodeCost')
  const cost = buildFactsCost(facts) ?? buildSessionCost(usage, selection)
  if (cost === undefined) return null
  return <span className="oc-dock-cost" title={cost.title}>{cost.value}</span>
}
