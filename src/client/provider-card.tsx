import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { fetchState, saveKey, type HostState } from './api.ts'

/**
 * The provider card on Settings → Models. It is deliberately a narrow key
 * surface: the full connection, account and model controls stay on the
 * dedicated Settings → OpenCode page, while first-run key entry is available
 * right where the Models page lists this provider.
 */
export function OpenCodeProviderCard(props: { t: (key: string) => string }): ReactNode {
  const { t } = props
  const [state, setState] = useState<HostState | null>(null)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = (): void => {
    void fetchState()
      .then((next) => { setState(next); setError(null) })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t('failed')))
  }

  useEffect(() => {
    let cancelled = false
    void fetchState()
      .then((next) => {
        if (cancelled) return
        setState(next)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : t('failed'))
      })
    return () => { cancelled = true }
  }, [t])

  const configured = state?.key.configured === true
  const ref = state?.config.apiKeyEnv ?? 'OPENCODE_API_KEY'

  const save = (): void => {
    if (draft.trim() === '') return
    setSaving(true)
    setNotice(null)
    setError(null)
    void saveKey(ref, draft.trim())
      .then(() => {
        setDraft('')
        setNotice(t('saved'))
        load()
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : t('failed')))
      .finally(() => setSaving(false))
  }

  return (
    <section className="oc-card">
      <h3 className="oc-card-title">
        {t('title')}
        <span className={`oc-badge ${configured ? 'oc-badge-ok' : 'oc-badge-warn'}`}>
          {configured ? t('keyConfigured') : t('keyMissing')}
        </span>
      </h3>
      <p className="oc-hint">{t('keyHint')}</p>
      <div className="oc-row">
        <input
          className="oc-input"
          style={{ flex: '1 1 220px' }}
          type="password"
          autoComplete="off"
          placeholder={t('pasteKey')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="button"
          className="oc-button oc-button-primary"
          disabled={saving || draft.trim() === ''}
          onClick={save}
        >
          {saving ? t('saving') : t('saveKey')}
        </button>
      </div>
      {notice === null ? null : <div className="oc-notice">{notice}</div>}
      {error === null ? null : <div className="oc-error">{error}</div>}
    </section>
  )
}
