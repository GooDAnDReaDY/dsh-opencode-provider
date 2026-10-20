/**
 * Normalize a tool's parameters schema to the object root the gateway
 * validates. Ported behavior from the Command Code provider: pass an object
 * root through, add the type to a type-less object-shaped schema, resolve a
 * local root `$ref`, merge combinators, and degrade anything else to a
 * permissive object rather than failing the whole turn.
 */

const MAX_DEPTH = 4

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isObjectShaped(node: Record<string, unknown>): boolean {
  return isRecord(node.properties)
    || isRecord(node.patternProperties)
    || Array.isArray(node.required)
    || node.additionalProperties !== undefined
}

function requiredNames(node: Record<string, unknown>): string[] {
  return Array.isArray(node.required)
    ? node.required.filter((name): name is string => typeof name === 'string')
    : []
}

function resolveLocalRef(root: Record<string, unknown>, ref: string): Record<string, unknown> | undefined {
  if (!ref.startsWith('#/')) return undefined
  let node: unknown = root
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isRecord(node)) return undefined
    node = node[segment]
  }
  return isRecord(node) ? node : undefined
}

function mergeCombinatorBranches(
  node: Record<string, unknown>,
  depth: number,
): Record<string, unknown> | undefined {
  if (depth >= MAX_DEPTH) return undefined
  const properties: Record<string, unknown> = {}
  const required = new Set<string>()
  const alternatives: string[][] = []
  let sawBranch = false

  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = node[key]
    if (!Array.isArray(branches)) continue
    const objectBranches: Record<string, unknown>[] = []
    for (const branch of branches) {
      if (!isRecord(branch)) continue
      objectBranches.push(normalizeToolParameters(branch, depth + 1))
    }
    if (objectBranches.length === 0) continue
    sawBranch = true
    const names = objectBranches.map(requiredNames)
    if (key === 'allOf') {
      for (const name of names.flat()) required.add(name)
    } else if (names.length > 0) {
      alternatives.push(names[0]!.filter((name) => names.every((list) => list.includes(name))))
    }
    for (const branch of objectBranches) {
      const branchProperties = isRecord(branch.properties) ? branch.properties : {}
      for (const [name, schema] of Object.entries(branchProperties)) {
        if (!(name in properties)) properties[name] = schema
      }
    }
  }
  if (!sawBranch) return undefined
  for (const group of alternatives) for (const name of group) required.add(name)

  const merged: Record<string, unknown> = { type: 'object', properties }
  if (required.size > 0) merged.required = [...required]
  if (node.additionalProperties !== undefined) merged.additionalProperties = node.additionalProperties
  for (const key of ['description', 'title'] as const) {
    if (node[key] !== undefined) merged[key] = node[key]
  }
  return merged
}

export function normalizeToolParameters(parameters: unknown, depth = 0): Record<string, unknown> {
  if (!isRecord(parameters)) return { type: 'object', properties: {}, additionalProperties: true }
  if (parameters.type === 'object') return parameters
  if (Array.isArray(parameters.type) && parameters.type.includes('object')) {
    return { ...parameters, type: 'object' }
  }

  if (parameters.type === undefined || parameters.type === null) {
    if (typeof parameters.$ref === 'string' && depth < MAX_DEPTH) {
      const target = resolveLocalRef(parameters, parameters.$ref)
      if (target !== undefined) {
        const { $ref: _ref, ...rest } = parameters
        return normalizeToolParameters({ ...target, ...rest }, depth + 1)
      }
    }
    if (isObjectShaped(parameters)) return { ...parameters, type: 'object' }
    const merged = mergeCombinatorBranches(parameters, depth)
    if (merged !== undefined) return merged
    if (typeof parameters.$ref === 'string') return { ...parameters, type: 'object' }
  }

  return { type: 'object', properties: {}, additionalProperties: true }
}
