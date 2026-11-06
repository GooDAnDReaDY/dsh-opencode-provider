import type { ToolSchema } from '@deepseek-ai/dsh-llm'

/** OpenCode default ceiling; user can configure maxTools up to 512. */
export const DEFAULT_MAX_TOOLS = 128
export const MAX_TOOLS = DEFAULT_MAX_TOOLS

/**
 * Harness and system tools that must survive the cap when a profile defines
 * too many tools (e.g. large MCP sets). Includes dsh core tools, ops_* tools
 * (from dsh-ops: ops_bash, ops_read_files, ops_grep, ops_glob, ...), and
 * essential file/shell capabilities.
 */
const CORE_TOOLS = new Set([
  'read', 'write', 'edit', 'apply_patch', 'bash', 'glob', 'grep',
  'task', 'todo', 'web_search', 'web_fetch', 'notebook',
  'read_file', 'write_file', 'edit_file', 'run_command', 'execute_command',
  'list_dir', 'view_file', 'find_files',
])

export function isCoreTool(name: string): boolean {
  if (CORE_TOOLS.has(name)) return true
  if (name.startsWith('ops_') || name.startsWith('dsh_')) return true
  if (name.startsWith('mcp__') && (name.includes('bash') || name.includes('file') || name.includes('terminal'))) {
    return true
  }
  return false
}

export interface LimitToolsResult {
  readonly tools: ToolSchema[]
  readonly dropped: readonly ToolSchema[]
}

/**
 * Deduplicate tools by name and partition core tools ahead of remaining tools.
 * Duplicate names are ambiguous anyway; first declaration wins.
 */
export function limitToolsResult(
  tools: readonly ToolSchema[] | undefined,
  max = DEFAULT_MAX_TOOLS,
): LimitToolsResult | undefined {
  if (tools === undefined) return undefined
  const seen = new Set<string>()
  const out: ToolSchema[] = []
  for (const tool of tools) {
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    out.push(tool)
  }
  if (out.length <= max) return { tools: out, dropped: [] }
  const core = out.filter((tool) => isCoreTool(tool.name))
  const rest = out.filter((tool) => !isCoreTool(tool.name))
  const kept = [...core, ...rest].slice(0, max)
  const keptSet = new Set(kept.map((t) => t.name))
  const dropped = out.filter((t) => !keptSet.has(t.name))
  return { tools: kept, dropped }
}

export function limitTools(
  tools: readonly ToolSchema[] | undefined,
  max = DEFAULT_MAX_TOOLS,
): ToolSchema[] | undefined {
  return limitToolsResult(tools, max)?.tools
}
