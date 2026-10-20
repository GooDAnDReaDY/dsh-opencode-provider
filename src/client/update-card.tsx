import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { fetchUpdate, installUpdate, type UpdateStatus } from './api.ts'

export function PluginUpdateCard(props: { t: (key: string) => string }): ReactNode {
  const { t } = props
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = (): void => {
    void fetchUpdate()
      .then((next) => { setStatus(next); setError(null) })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : t('updateCheckFailed'))
      })
  }

  useEffect(() => { load() }, [])

  const update = (): void => {
    setBusy(true)
    setError(null)
    setNotice(null)
    void installUpdate()
      .then((next) => {
        setStatus(next)
        setNotice(next.restartRequired === true ? t('restartRequired') : t('upToDate'))
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : t('updateFailed'))
      })
      .finally(() => setBusy(false))
  }

  return (
    <section className="oc-card">
      <h3 className="oc-card-title">
        {t('pluginUpdate')}
        {status === null
          ? null
          : status.updateAvailable
            ? <span className="oc-badge oc-badge-warn">{t('updateAvailable')}</span>
            : <span className="oc-badge oc-badge-ok">{t('upToDate')}</span>}
      </h3>
      {status === null ? <p className="oc-hint">{error ?? t('checking')}</p> : (
        <>
          <div className="oc-row">
            <span className="oc-badge">{t('currentVersion')}: {status.currentVersion}</span>
            <span className="oc-badge">{t('latestVersion')}: {status.latestVersion ?? '—'}</span>
          </div>
          {status.canAutoUpdate ? (
            <button
              type="button"
              className="oc-button"
              disabled={busy || !status.updateAvailable || status.updatedVersion !== undefined}
              onClick={update}
            >
              {busy ? t('updating') : t('updateNow')}
            </button>
          ) : <p className="oc-hint">{t('updateUnavailable')}</p>}
        </>
      )}
      {notice === null ? null : <div className="oc-notice">{notice}</div>}
      {error === null ? null : <div className="oc-error">{error}</div>}
    </section>
  )
}
