import { fmtDate } from './format'
import type { TFunction, TVars } from '../i18n/index'
import type { Json } from '../types/db'

/** What notifText needs: a stored row or the app's mapped notification. */
export interface NotifLike { kind?: string | null; params?: Record<string, Json> | null; body?: string | null }

/**
 * Notifications are stored with a `kind` + `params` and translated when shown,
 * so each viewer reads them in their own UI language (not the language that was
 * active when the row was written). Rows without a kind (old rows the migration
 * could not recognise, free-text admin messages) fall back to the stored body.
 */
/** App badge ids (badges.badge_id) → i18n key under `badges.` */
export const BADGE_LABEL_KEY: Record<string, string> = {
  profil: 'profileComplete',
  'first-join': 'firstJoin',
  'first-rate': 'firstRate',
  'first-host': 'firstHost',
}

export function notifText(n: NotifLike | null | undefined, t: TFunction, locale?: string): string {
  if (!n) return ''
  if (!n.kind) return n.body || ''
  const params: TVars = {}
  for (const [k, v] of Object.entries(n.params || {})) params[k] = v == null || typeof v === 'number' ? v : String(v)
  if (n.kind === 'badgeEarned') {
    const key = params.badge ? `badges.${params.badge}` : null
    const label = key ? t(key) : null
    params.label = label && label !== key ? label : params.label || ''
  }
  // Lesson notifications carry a subject id and an ISO date: translate both.
  if (params.subject) {
    const sk = `lessons.subjects.${params.subject}`
    const label = t(sk)
    if (label !== sk) params.subject = label
  }
  if (params.at && locale) params.at = fmtDate(String(params.at), locale)
  const key = `notifications.${n.kind}`
  const text = t(key, params)
  return text === key ? n.body || '' : text
}
