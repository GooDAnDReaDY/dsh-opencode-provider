/**
 * Collision-free credential ref for an OpenCode auth entry. Hex encoding is
 * injective (unlike replacing punctuation with underscores) and uses only
 * characters accepted by credential references.
 */
export function authRefForEntry(entry: string): string {
  let hex = ''
  for (const byte of new TextEncoder().encode(entry)) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return `OPENCODE_AUTH_${hex}`
}
