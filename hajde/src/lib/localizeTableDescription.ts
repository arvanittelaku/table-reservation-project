/* Default descriptions the app writes when a host leaves the field empty, in
 * every language (copied from i18n/locales/phase4 + phase8). Kept here so this
 * helper does not pull all four language files into the startup bundle. If a
 * default text changes in the locale files, update it here too.
 * (Checked by scripts/check-system-descriptions.mjs.) */
export const SYSTEM_DESCRIPTIONS = {
  "sq": {
    "ride": "Ulëse të lira. Për shoqëri rrugës!",
    "trip": "Po kërkoj shoqëri për këtë udhëtim. Eja bashkohu!",
    "table": "Eja bashkohu, të njihemi!",
    "wednesday": "6 persona të përputhur nga përgjigjet e kuizit. Të njëjtat interesa, energji e ngjashme. Restoranti mbahet sekret deri 24 orë para darkës. Vjen, ulesh, njihesh.",
    "sport": "Na mungojnë lojtarë. Hajde luajmë!"
  },
  "en": {
    "ride": "Free seats. Good company on the road!",
    "trip": "Looking for company on this trip. Join us!",
    "table": "Come join us, let’s get to know each other!",
    "wednesday": "6 people matched from quiz answers. Same interests, similar energy. Restaurant stays secret until 24 hours before dinner. Come, sit, meet.",
    "sport": "We need players. Come play!"
  },
  "de": {
    "ride": "Freie Plätze. Gute Gesellschaft unterwegs!",
    "trip": "Suche Gesellschaft für diese Reise. Komm mit!",
    "table": "Komm mit, lass uns uns kennenlernen!",
    "wednesday": "6 Personen passend zu deinen Quiz-Antworten. Gleiche Interessen, ähnliche Energie. Restaurant bleibt bis 24 Stunden vor dem Essen geheim. Komm, setz dich, lerne Leute kennen.",
    "sport": "Uns fehlen Spieler. Komm und spiel mit!"
  },
  "mk": {
    "ride": "Слободни места. Добро дружење на пат!",
    "trip": "Барам дружење за ова патување. Приклучи се!",
    "table": "Дојди, да се запознаеме!",
    "wednesday": "6 луѓе совпаднати од одговорите на квизот. Исти интереси, слична енергија. Ресторанот останува таен до 24 часа пред вечерата. Дојди, седни, запознај се.",
    "sport": "Ни недостасуваат играчи. Дојди да играме!"
  }
}

/** Map any locale variant of a system default description → i18n key */
const SYSTEM_DESC_KEY = new Map<string, string>(
  Object.values(SYSTEM_DESCRIPTIONS).flatMap((d): Array<[string, string]> => [
    [d.ride, 'feed.defaultDescRide'],
    [d.trip, 'feed.defaultDescTrip'],
    [d.table, 'feed.defaultDescTable'],
    [d.wednesday, 'wednesdaySeed.description'],
    [d.sport, 'sports.defaultDesc'],
  ]),
)

/**
 * System-seeded table descriptions are stored once in DB (creator locale).
 * Re-localize known defaults for the active UI locale.
 */
export function localizeTableDescription(desc: string, t: (key: string) => string): string {
  const trimmed = desc?.trim()
  if (!trimmed) return desc
  const key = SYSTEM_DESC_KEY.get(trimmed)
  return key ? t(key) : desc
}

/* Areas the app writes itself (ride departure prefix, default "center"), in every
 * language (feed.areaDeparture / feed.areaCenter / createTable.defaultAreaCenter). */
export const SYSTEM_AREAS = {
  "sq": { "departurePrefix": "Nisja: ", "center": "Qendra", "centerLower": "qendra" },
  "en": { "departurePrefix": "Departure: ", "center": "Center", "centerLower": "center" },
  "de": { "departurePrefix": "Abfahrt: ", "center": "Zentrum", "centerLower": "zentrum" },
  "mk": { "departurePrefix": "Поаѓање: ", "center": "Центар", "centerLower": "центар" },
}
const AREA_PREFIXES = Object.values(SYSTEM_AREAS).map((a) => a.departurePrefix)
const CENTERS = new Set(Object.values(SYSTEM_AREAS).flatMap((a) => [a.center, a.centerLower]))

/** Re-localize the generated parts of a table's area ("Nisja: qendra" → "Departure: center"). */
export function localizeTableArea(area: string, t: (key: string, vars?: Record<string, string>) => string): string {
  const a = area?.trim()
  if (!a) return area
  if (CENTERS.has(a)) return t('feed.areaCenter')
  const prefix = AREA_PREFIXES.find((p) => a.startsWith(p))
  if (!prefix) return area
  const rest = a.slice(prefix.length).trim()
  return t('feed.areaDeparture', { place: CENTERS.has(rest) ? t('createTable.defaultAreaCenter') : rest })
}

/** The place part of a ride's area, without the "Departure:" prefix of any language. */
export function stripDeparturePrefix(area: string | null | undefined): string {
  const a = (area || '').trim()
  const prefix = AREA_PREFIXES.find((p) => a.startsWith(p))
  return prefix ? a.slice(prefix.length).trim() : a
}
