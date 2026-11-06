const KEY = 'dsh-opencode-admin-token'

function storage(): Storage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch (error) {
    void error
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
