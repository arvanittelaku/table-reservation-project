/** Local date/time helpers for table event_datetime (avoid UTC date split bugs). */

const GOOGLE_MAPS_LINK_PATTERN =
  /^https?:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)/i

export function localDateInputValue(d = new Date()) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function defaultEventSchedule() {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(0)
  d.setHours(d.getHours() + 2)
  return {
    eventDate: localDateInputValue(d),
    eventTime: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
  }
}

/** Combine HTML date + time inputs into UTC ISO string, or null if invalid. */
export function buildEventDatetime(eventDate, eventTime) {
  if (!eventDate || !eventTime) return null
  const dt = new Date(`${eventDate}T${eventTime}`)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

/** True when event is in the future (optional skew avoids insert race). */
export function isFutureEventDatetime(eventDate, eventTime, skewMs = 30_000) {
  const iso = buildEventDatetime(eventDate, eventTime)
  if (!iso) return false
  return new Date(iso).getTime() > Date.now() - skewMs
}

export function isValidMapsLink(url) {
  const trimmed = (url || '').trim()
  if (!trimmed) return false
  return GOOGLE_MAPS_LINK_PATTERN.test(trimmed)
}

export function mapsSearchUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || '')}`
}

/** Prefer host-pasted Google Maps link; legacy rows fall back to text search. */
export function mapsUrlForTable(t) {
  const link = (t?.mapsLink || '').trim()
  if (isValidMapsLink(link)) return link
  const query =
    t?.cat === 'vozitje'
      ? `${(t.area || '').replace('Nisja: ', '')}, ${t.city}, Kosovo`
      : t?.cat === 'udhetim'
        ? t.cafe
        : `${t.cafe}, ${t.area ? `${t.area}, ` : ''}${t.city}, Kosovo`
  return mapsSearchUrl(query)
}

/** Revealed Wednesday Dinner restaurant — use stored link or name/address search. */
export function wednesdayMapsUrl(restaurant) {
  const link = (restaurant?.maps_link || '').trim()
  if (isValidMapsLink(link)) return link
  const query = [restaurant?.name, restaurant?.address, restaurant?.city].filter(Boolean).join(', ')
  return mapsSearchUrl(query)
}
