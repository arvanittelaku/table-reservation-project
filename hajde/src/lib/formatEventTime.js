const LOCALE_MAP = { sq: 'sq-AL', en: 'en-US', de: 'de-DE', mk: 'mk-MK' }

const TODAY_LABELS = { sq: 'Sot', en: 'Today', de: 'Heute', mk: 'Денес' }
const TOMORROW_LABELS = { sq: 'Nesër', en: 'Tomorrow', de: 'Morgen', mk: 'Утре' }

/**
 * Human-readable table event time from ISO timestamp.
 */
export function formatEventTime(isoString, locale = 'sq') {
  if (!isoString) return '-'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return '-'

  const loc = LOCALE_MAP[locale] || LOCALE_MAP.sq
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  const timeStr = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })

  if (isToday) return `${TODAY_LABELS[locale] || TODAY_LABELS.sq}, ${timeStr}`

  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) {
    return `${TOMORROW_LABELS[locale] || TOMORROW_LABELS.sq}, ${timeStr}`
  }

  return `${d.toLocaleDateString(loc, { day: 'numeric', month: 'short' })}, ${timeStr}`
}

export function formatBlockDate(isoString, locale = 'sq') {
  if (!isoString) return ''
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return ''
  const loc = LOCALE_MAP[locale] || LOCALE_MAP.sq
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function isTableExpired(isoString) {
  if (!isoString) return true
  const d = new Date(isoString)
  return Number.isNaN(d.getTime()) || d <= new Date()
}
