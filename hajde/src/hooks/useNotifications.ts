import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  clearAllNotifications,
  fetchNotifications,
  getAuthEmail,
  getEmailNotificationsEnabled,
  insertNotification,
  markAllRead,
  setEmailNotificationsEnabled,
  subscribeNotifications,
} from '../api/notifications'
import { useI18n } from '../i18n/I18nContext'
import { notifText } from '../lib/notifText'
import { queryKeys } from '../lib/queryClient'
import type { Json, NotificationRow } from '../types/db'

/** A notification as the bell panel shows it. */
export interface UiNotification {
  id: string
  icon: string
  text: string
  body: string
  kind: string | null
  params: Record<string, Json>
  time: string
  read: boolean
  created_at: string
}

function formatNotifTime(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

const NO_NOTIFS: UiNotification[] = []

export function mapNotif(row: NotificationRow): UiNotification {
  return {
    id: row.id,
    icon: row.icon || '🔔',
    text: row.body,
    body: row.body,
    kind: row.kind || null,
    params: row.params || {},
    time: formatNotifTime(row.created_at),
    read: !!row.read,
    created_at: row.created_at,
  }
}

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.value = 0.04
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    o.stop(ctx.currentTime + 0.4)
  } catch {
    /* ignore */
  }
}

/**
 * Live notifications for the signed-in user.
 */
export function useNotifications(userId: string | null | undefined) {
  const { t, locale } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const localeRef = useRef(locale)
  localeRef.current = locale
  const queryClient = useQueryClient()
  const queryKey = queryKeys.notifications(userId ?? '')
  const query = useQuery({
    queryKey,
    queryFn: async () => (await fetchNotifications()).map(mapNotif),
    enabled: !!userId,
    // new rows and read flags arrive over realtime (setNotifs below)
    staleTime: 5 * 60_000,
  })
  const notifs: UiNotification[] = (userId && !query.isError && query.data) || NO_NOTIFS
  /** Writes the cached list (realtime events, optimistic read/clear). */
  const keyRef = useRef(queryKey)
  keyRef.current = queryKey
  const setNotifs = useCallback((update: (prev: UiNotification[]) => UiNotification[]) => {
    queryClient.setQueryData<UiNotification[]>(keyRef.current, (prev) => update(prev ?? []))
  }, [queryClient])
  const [actionError, setError] = useState<unknown>(null)
  const error = actionError ?? (query.isError ? query.error : null)
  const [authEmail, setAuthEmail] = useState<string | null>(null)
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [emailSaving, setEmailSaving] = useState(false)
  /** When set, forces badge count (used to zero on panel open). */
  const [unreadForced, setUnreadForced] = useState<number | null>(null)
  // chime only for rows that arrive after the first list was loaded
  const primed = useRef(false)
  if (userId && query.status !== 'pending') primed.current = true

  const refetchQuery = query.refetch
  const refetch = useCallback(async () => {
    if (!userId) return
    setError(null)
    await refetchQuery()
  }, [userId, refetchQuery])

  useEffect(() => {
    if (!userId) {
      setAuthEmail(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const [email, enabled] = await Promise.all([
          getAuthEmail(),
          getEmailNotificationsEnabled(),
        ])
        if (!cancelled) {
          setAuthEmail(email)
          setEmailEnabled(enabled)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return undefined
    return subscribeNotifications(userId, {
      onInsert: (row) => {
        setUnreadForced(null) // allow badge to show new unread
        setNotifs((prev) => {
          if (prev.some((n) => n.id === row.id)) return prev
          return [mapNotif(row), ...prev]
        })
        if (primed.current) {
          playChime()
          try {
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification('ejaBashkohu', { body: notifText(mapNotif(row), tRef.current, localeRef.current), icon: undefined })
            }
          } catch {
            /* ignore */
          }
        }
      },
      onUpdate: (row) => {
        setNotifs((prev) => prev.map((n) => (n.id === row.id ? mapNotif(row) : n)))
      },
    })
  }, [userId, setNotifs])

  const computedUnread = notifs.filter((n) => !n.read).length
  const unread = unreadForced !== null ? unreadForced : computedUnread

  const markRead = useCallback(async () => {
    if (!userId) return
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadForced(0)
    try {
      await markAllRead()
    } catch (e) {
      setError(e)
      await refetch()
    }
  }, [userId, refetch, setNotifs])

  /** Clear panel list (Pastro) — deletes rows so they stay gone after reload. */
  const clearNotifs = useCallback(async () => {
    setNotifs(() => [])
    setUnreadForced(0)
    if (!userId) return
    try {
      await clearAllNotifications()
    } catch (e) {
      setError(e)
      await refetch()
    }
  }, [userId, refetch, setNotifs])

  /** Client-side notification (also lands in the bell via DB + realtime). */
  /**
   * pushNotif(kind, params, icon): stores kind + params so every viewer sees it in
   * their own language. `body` keeps the current-language text as a fallback.
   */
  const pushNotif = useCallback(
    async (kind: string, params: Record<string, Json> = {}, icon = '🔔') => {
      if (!userId) return
      try {
        const body = notifText({ kind, params, body: kind }, tRef.current, localeRef.current)
        await insertNotification({ body, icon, kind, params })
      } catch (e) {
        setError(e)
      }
    },
    [userId],
  )

  const toggleEmailNotifications = useCallback(async () => {
    setEmailSaving(true)
    try {
      const next = !emailEnabled
      await setEmailNotificationsEnabled(next)
      setEmailEnabled(next)
    } catch (e) {
      setError(e)
    } finally {
      setEmailSaving(false)
    }
  }, [emailEnabled])

  return {
    notifs,
    unread,
    setUnread: setUnreadForced,
    loading: !!userId && query.isFetching,
    error,
    markRead,
    clearNotifs,
    pushNotif,
    refetch,
    authEmail,
    emailEnabled,
    emailSaving,
    toggleEmailNotifications,
  }
}
