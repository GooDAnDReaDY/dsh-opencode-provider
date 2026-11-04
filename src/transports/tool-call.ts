/** Wire fields are untrusted JSON: never forward null/numeric ids or names. */
export function toolCallId(value: unknown, fallback: string): string {
  return typeof value === 'string' && value !== '' ? value : fallback
}

export function toolCallName(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function toolCallArguments(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
