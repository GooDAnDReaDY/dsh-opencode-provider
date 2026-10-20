import type { ToolSchema } from '@deepseek-ai/dsh-llm'

/** OpenCode rejects a request whose `tools` array has more than 128 items. */
export const MAX_TOOLS = 128

/** Harness tools that must survive the cap when a profile defines too many. */
const CORE_TOOLS = new Set([
  'read', 'write', 'edit', 'apply_patch', 'bash', 'glob', 'grep',
  'task', 'todo', 'web_search', 'web_fetch', 'notebook',
])

/**
 * Deduplicate tools by name and keep at most the provider's limit. Duplicate
 * names would be ambiguous to the model anyway; the first declaration wins.
 * At the cap, core harness tools move ahead of the rest so a large MCP set
 * cannot silently evict file/shell access.
 */
export function limitTools(
  tools: readonly ToolSchema[] | undefined,
  max = MAX_TOOLS,
): ToolSchema[] | undefined {
  if (tools === undefined) return undefined
  const seen = new Set<string>()
  const out: ToolSchema[] = []
  for (const tool of tools) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    out.push(tool)
  }
  if (out.length <= max) return out
  const core = out.filter((tool) => CORE_TOOLS.has(tool.name))
  const rest = out.filter((tool) => !CORE_TOOLS.has(tool.name))
  return [...core, ...rest].slice(0, max)
}
