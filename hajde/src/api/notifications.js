import { sb } from '../supabaseClient'

async function currentUserId() {
  const { data, error } = await sb.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}

/**
 * Last 50 notifications for the signed-in user, newest first.
 */
export async function fetchNotifications() {
  const userId = await currentUserId()
  if (!userId) return []

  const { data, error } = await sb
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return data ?? []
}

/** @deprecated use fetchNotifications */
export const loadNotifications = fetchNotifications

/** Mark every unread notification as read for the current user. */
export async function markAllRead() {
  const userId = await currentUserId()
  if (!userId) throw new Error('Not signed in')

  const { error } = await sb
    .from('notifications')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false)

  if (error) throw error
}

/** Delete all notifications for the current user (Pastro). */
export async function clearAllNotifications() {
  const userId = await currentUserId()
  if (!userId) throw new Error('Not signed in')

  const { error } = await sb
    .from('notifications')
    .delete()
    .eq('user_id', userId)

  if (error) throw error
}

/** Insert a notification for the current user (client-side events). */
export async function insertNotification({ body, icon = '🔔', kind = null, params = {} }) {
  const userId = await currentUserId()
  if (!userId) throw new Error('Not signed in')

  const { data, error } = await sb
    .from('notifications')
    .insert({ user_id: userId, body, icon, kind, params })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Award a badge once per user, ever (server-side, atomic). Returns true only the
 * first time; the server also writes the single "badge earned" notification.
 */
export async function awardBadgeOnce(badgeId) {
  const { data, error } = await sb.rpc('award_badge', { p_badge: badgeId })
  if (error) throw error
  return data === true
}

/**
 * Realtime notifications for a user.
 * Accepts either:
 *   subscribeNotifications(userId, { onInsert, onUpdate })
 *   subscribeNotifications(onNew)  // legacy INSERT-only
 */
export function subscribeNotifications(userIdOrOnNew, maybeHandlers) {
  const legacy = typeof userIdOrOnNew === 'function'
  const fixedUserId = legacy ? null : userIdOrOnNew
  const onInsert = legacy
    ? userIdOrOnNew
    : maybeHandlers?.onInsert
  const onUpdate = legacy ? null : maybeHandlers?.onUpdate

  let channel = null
  let cancelled = false

  ;(async () => {
    const userId = fixedUserId || (await currentUserId())
    if (cancelled || !userId) return

    channel = sb
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          onInsert?.(payload.new)
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          onUpdate?.(payload.new)
        },
      )
      .subscribe()

    if (cancelled) {
      sb.removeChannel(channel)
      channel = null
    }
  })()

  return () => {
    cancelled = true
    if (channel) sb.removeChannel(channel)
  }
}

/** Auth email for the notification panel (not local profile state). */
export async function getAuthEmail() {
  const { data, error } = await sb.auth.getUser()
  if (error || !data.user) return null
  return data.user.email ?? null
}

/**
 * Persist email-notification preference on profiles.user_preferences.
 * Expects a JSON/JSONB column; merges { email_notifications: boolean }.
 */
export async function setEmailNotificationsEnabled(enabled) {
  const userId = await currentUserId()
  if (!userId) throw new Error('Not signed in')

  const { data: existing, error: readError } = await sb
    .from('profiles')
    .select('user_preferences')
    .eq('id', userId)
    .maybeSingle()

  if (readError) throw readError

  const prev =
    existing?.user_preferences && typeof existing.user_preferences === 'object'
      ? existing.user_preferences
      : {}

  const next = { ...prev, email_notifications: !!enabled }

  const { data, error } = await sb
    .from('profiles')
    .update({ user_preferences: next })
    .eq('id', userId)
    .select('user_preferences')
    .single()

  if (error) throw error
  return data.user_preferences
}

export async function getEmailNotificationsEnabled() {
  const userId = await currentUserId()
  if (!userId) return true

  const { data, error } = await sb
    .from('profiles')
    .select('user_preferences')
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error

  const prefs = data?.user_preferences
  if (prefs && typeof prefs === 'object' && 'email_notifications' in prefs) {
    return !!prefs.email_notifications
  }
  // Default ON when unset
  return true
}
