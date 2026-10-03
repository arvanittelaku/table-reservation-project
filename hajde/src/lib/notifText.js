/**
 * Notifications are stored with a `kind` + `params` and translated when shown,
 * so each viewer reads them in their own UI language (not the language that was
 * active when the row was written). Rows without a kind (old rows the migration
 * could not recognise, free-text admin messages) fall back to the stored body.
 */

/** App badge ids (badges.badge_id) → i18n key under `badges.` */
export const BADGE_LABEL_KEY = {
  profil: 'profileComplete',
  'first-join': 'firstJoin',
  'first-rate': 'firstRate',
  'first-host': 'firstHost',
}

export function notifText(n, t) {
  if (!n) return ''
  if (!n.kind) return n.body || ''
  const params = { ...(n.params || {}) }
  if (n.kind === 'badgeEarned') {
    const key = params.badge ? `badges.${params.badge}` : null
    const label = key ? t(key) : null
    params.label = label && label !== key ? label : params.label || ''
  }
  const key = `notifications.${n.kind}`
  const text = t(key, params)
  return text === key ? n.body || '' : text
}
