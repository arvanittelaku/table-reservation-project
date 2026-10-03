/* Shared date/number formatting (used by the app and the admin console). */

const DATE_LOCALE = { sq: 'sq-AL', en: 'en-GB', de: 'de-DE', mk: 'mk-MK' }
export const loc = (locale) => DATE_LOCALE[locale] || locale || 'en-GB'

export function fmtMoney(cents, currency = 'EUR', locale = 'sq') {
  const n = Number(cents || 0) / 100
  try {
    return new Intl.NumberFormat(loc(locale), { style: 'currency', currency, minimumFractionDigits: 2 }).format(n)
  } catch {
    return `€${n.toFixed(2)}`
  }
}

export function fmtNum(n, locale = 'sq') {
  if (n === null || n === undefined) return '–'
  return new Intl.NumberFormat(loc(locale)).format(Number(n))
}

// Browsers ship thin Albanian (sq) locale data ("2026 M10 3", "-40 min"), so sq is formatted by hand.
const SQ_MONTHS = ['jan', 'shk', 'mar', 'pri', 'maj', 'qer', 'korr', 'gush', 'sht', 'tet', 'nën', 'dhj']
export const pad2 = (n) => String(n).padStart(2, '0')

export function fmtDate(iso, locale, withTime = true) {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  if (locale === 'sq') {
    const base = `${d.getDate()} ${SQ_MONTHS[d.getMonth()]} ${d.getFullYear()}`
    return withTime ? `${base}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : base
  }
  return d.toLocaleString(loc(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  })
}

const SQ_UNITS = { second: 'sek', minute: 'min', hour: 'orë', day: 'ditë', month: 'muaj', year: 'vit' }

export function fmtRelative(iso, locale) {
  if (!iso) return '–'
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  let value
  let unit
  if (abs < 60) { value = diff; unit = 'second' }
  else if (abs < 3600) { value = diff / 60; unit = 'minute' }
  else if (abs < 86400) { value = diff / 3600; unit = 'hour' }
  else if (abs < 86400 * 30) { value = diff / 86400; unit = 'day' }
  else if (abs < 86400 * 365) { value = diff / (86400 * 30); unit = 'month' }
  else { value = diff / (86400 * 365); unit = 'year' }
  const n = Math.round(value)
  if (locale === 'sq') {
    if (unit === 'second') return 'tani'
    const label = unit === 'year' && Math.abs(n) !== 1 ? 'vjet' : SQ_UNITS[unit]
    return n < 0 ? `para ${Math.abs(n)} ${label}` : `për ${n} ${label}`
  }
  const rtf = new Intl.RelativeTimeFormat(loc(locale), { numeric: 'auto' })
  return unit === 'second' ? rtf.format(0, 'second') : rtf.format(n, unit)
}

export function fmtPeriod(period, range, locale) {
  const d = new Date(period)
  if (Number.isNaN(d.getTime())) return String(period).slice(0, 10)
  if (range === 'year') return String(d.getFullYear())
  if (locale === 'sq') {
    return range === 'month' ? `${SQ_MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` : `${d.getDate()} ${SQ_MONTHS[d.getMonth()]}`
  }
  if (range === 'month') return d.toLocaleDateString(loc(locale), { month: 'short', year: '2-digit' })
  return d.toLocaleDateString(loc(locale), { day: 'numeric', month: 'short' })
}

