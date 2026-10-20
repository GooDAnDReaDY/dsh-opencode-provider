import type { ToolSchema } from '@deepseek-ai/dsh-llm'

/** OpenCode rejects a request whose `tools` array has more than 128 items. */
export const MAX_TOOLS = 128

/**
 * Deduplicate tools by name and keep at most the provider's limit. Duplicate
 * names would be ambiguous to the model anyway; the first declaration wins.
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
    if (out.length >= max) break
    seen.add(tool.name)
    out.push(tool)
  }
  return out
}
