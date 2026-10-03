// Verifies lib/localizeTableDescription.js still matches the locale files.
// Run: node scripts/check-system-descriptions.mjs
import { SYSTEM_DESCRIPTIONS } from '../src/lib/localizeTableDescription.js'
let ok = true
for (const l of ['sq', 'en', 'de', 'mk']) {
  const { feed } = await import(`../src/i18n/locales/phase4/${l}.js`)
  const { wednesdaySeed } = await import(`../src/i18n/locales/phase8/${l}.js`)
  const want = { ride: feed.defaultDescRide, trip: feed.defaultDescTrip, table: feed.defaultDescTable, wednesday: wednesdaySeed.description }
  for (const [k, v] of Object.entries(want)) if (SYSTEM_DESCRIPTIONS[l][k] !== v) { ok = false; console.error(`mismatch ${l}.${k}`) }
}
console.log(ok ? 'system descriptions in sync' : 'OUT OF SYNC')
process.exit(ok ? 0 : 1)
