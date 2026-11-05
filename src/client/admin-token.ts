const KEY = 'dsh-opencode-admin-token'

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function getAdminToken(): string {
  return storage()?.getItem(KEY) ?? ''
}

export function setAdminToken(token: string): void {
  const value = token.trim()
  if (value === '') storage()?.removeItem(KEY)
  else storage()?.setItem(KEY, value)
}

export function hasAdminToken(): boolean {
  return getAdminToken() !== ''
}
