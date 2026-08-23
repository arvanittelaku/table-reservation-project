import { feed as sqFeed } from '../i18n/locales/phase4/sq.js'
import { feed as enFeed } from '../i18n/locales/phase4/en.js'
import { feed as deFeed } from '../i18n/locales/phase4/de.js'
import { feed as mkFeed } from '../i18n/locales/phase4/mk.js'
import { wednesdaySeed as sqWed } from '../i18n/locales/phase8/sq.js'
import { wednesdaySeed as enWed } from '../i18n/locales/phase8/en.js'
import { wednesdaySeed as deWed } from '../i18n/locales/phase8/de.js'
import { wednesdaySeed as mkWed } from '../i18n/locales/phase8/mk.js'

/** Map any locale variant of a system default description → i18n key */
const SYSTEM_DESC_KEY = new Map([
  ...[sqFeed, enFeed, deFeed, mkFeed].flatMap((f) => [
    [f.defaultDescRide, 'feed.defaultDescRide'],
    [f.defaultDescTrip, 'feed.defaultDescTrip'],
    [f.defaultDescTable, 'feed.defaultDescTable'],
  ]),
  ...[sqWed, enWed, deWed, mkWed].map((w) => [w.description, 'wednesdaySeed.description']),
])

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
