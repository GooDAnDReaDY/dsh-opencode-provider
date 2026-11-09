import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { fetchNotices } from './api.ts'
import { CONFIG_CHANGED_EVENT } from './events.ts'

interface SwitchNoticeProps {
  readonly sessionId?: unknown
  readonly t: (key: string) => string
}

interface Notice {
  readonly account: string
  readonly reason: string
  readonly at: number
}

/** Ambient notice under the composer when this conversation switched accounts. */
export function SwitchNotice({ sessionId, t }: SwitchNoticeProps): ReactNode {
  const [notice, setNotice] = useState<Notice | null>(null)
  const seenAt = useRef(Date.now() - 5_000)

  useEffect(() => {
    if (sessionId === undefined || String(sessionId) === '') return
    let alive = true
    let timer: NodeJS.Timeout | undefined

    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }

    const poll = (): void => {
      void fetchNotices()
        .then(({ events, enabled }) => {
          if (!alive) return
          if (enabled === false) {
            setNotice(null)
            clearTimer()
            return
          }
          if (timer === undefined) {
            timer = setInterval(poll, 5_000)
          }
          const event = events
            .filter((entry) => entry.session === String(sessionId)
              && entry.at > seenAt.current
              && entry.ok
              && (entry.reason === 'rotation' || entry.reason === 'quota-fallback'))
            .sort((left, right) => right.at - left.at)[0]
          if (event === undefined) return
          seenAt.current = event.at
          setNotice({ account: event.account, reason: event.reason, at: event.at })
        })
        .catch(() => {
          // The ambient notice is optional; a failed poll must not disturb chat.
        })
    }
    poll()

    const onConfigChanged = (): void => { poll() }
    window.addEventListener(CONFIG_CHANGED_EVENT, onConfigChanged)

    return () => {
      alive = false
      clearTimer()
      window.removeEventListener(CONFIG_CHANGED_EVENT, onConfigChanged)
    }
  }, [sessionId])

  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), 60_000)
    return () => clearTimeout(timer)
  }, [notice])

  if (notice === null) return null
  const reason = notice.reason === 'quota-fallback' ? t('routingFallback') : t('routingRotation')
  return (
    <div className="oc-switch-notice" role="status">
      {t('accountSwitchNotice')
        .replace('{account}', notice.account)
        .replace('{reason}', reason)}
    </div>
  )
}
