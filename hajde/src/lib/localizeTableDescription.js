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
    "wednesday": "6 persona të përputhur nga përgjigjet e kuizit. Të njëjtat interesa, energji e ngjashme. Restoranti mbahet sekret deri 24 orë para darkës. Vjen, ulesh, njihesh."
  },
  "en": {
    "ride": "Free seats. Good company on the road!",
    "trip": "Looking for company on this trip. Join us!",
    "table": "Come join us, let’s get to know each other!",
    "wednesday": "6 people matched from quiz answers. Same interests, similar energy. Restaurant stays secret until 24 hours before dinner. Come, sit, meet."
  },
  "de": {
    "ride": "Freie Plätze. Gute Gesellschaft unterwegs!",
    "trip": "Suche Gesellschaft für diese Reise. Komm mit!",
    "table": "Komm mit, lass uns uns kennenlernen!",
    "wednesday": "6 Personen passend zu deinen Quiz-Antworten. Gleiche Interessen, ähnliche Energie. Restaurant bleibt bis 24 Stunden vor dem Essen geheim. Komm, setz dich, lerne Leute kennen."
  },
  "mk": {
    "ride": "Слободни места. Добро дружење на пат!",
    "trip": "Барам дружење за ова патување. Приклучи се!",
    "table": "Дојди, да се запознаеме!",
    "wednesday": "6 луѓе совпаднати од одговорите на квизот. Исти интереси, слична енергија. Ресторанот останува таен до 24 часа пред вечерата. Дојди, седни, запознај се."
  }
}

/** Map any locale variant of a system default description → i18n key */
const SYSTEM_DESC_KEY = new Map(
  Object.values(SYSTEM_DESCRIPTIONS).flatMap((d) => [
    [d.ride, 'feed.defaultDescRide'],
    [d.trip, 'feed.defaultDescTrip'],
    [d.table, 'feed.defaultDescTable'],
    [d.wednesday, 'wednesdaySeed.description'],
  ]),
)

/**
 * System-seeded table descriptions are stored once in DB (creator locale).
 * Re-localize known defaults for the active UI locale.
 */
export function localizeTableDescription(desc, t) {
  const trimmed = desc?.trim()
  if (!trimmed) return desc
  const key = SYSTEM_DESC_KEY.get(trimmed)
  return key ? t(key) : desc
}
