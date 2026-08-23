/**
 * Verify table creation + event_datetime handling (TEST 1-3).
 * Run: node scripts/verify-table-create.mjs
 */
import { createClient } from '@supabase/supabase-js'
import {
  buildEventDatetime,
  defaultEventSchedule,
  isFutureEventDatetime,
  localDateInputValue,
} from '../src/lib/eventSchedule.js'
import { formatEventTime } from '../src/lib/formatEventTime.js'
import { mapError } from '../src/lib/errorMap.js'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const ts = Date.now()
let failed = 0
function pass(label, ok, detail = '') {
  if (ok) console.log(`PASS  ${label}${detail ? `: ${detail}` : ''}`)
  else { failed++; console.error(`FAIL  ${label}${detail ? `: ${detail}` : ''}`) }
}

async function signup() {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `tbl-create-${ts}@test.local`,
      password: 'TestPass123!',
      data: { first_name: 'Tbl', last_name: 'Create', age: 28 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(JSON.stringify(data))
  return data
}

async function insertTable(sb, hostId, { event_datetime, title }) {
  return sb.from('tables').insert({
    kind: 'tavoline',
    category: 'kafe',
    title,
    area: 'Qendra',
    city: 'Prishtinë',
    time_label: formatEventTime(event_datetime),
    event_datetime,
    starts_at: event_datetime,
    spots: 4,
    langs: ['sq'],
    tags: [],
    description: 'verify-table-create',
    host_id: hostId,
  }).select('id, event_datetime, time_label').single()
}

async function main() {
  // Unit: default schedule uses local date aligned with local time
  const sched = defaultEventSchedule()
  pass('default schedule has date+time', sched.eventDate && sched.eventTime)
  pass('default schedule is future', isFutureEventDatetime(sched.eventDate, sched.eventTime))

  const session = await signup()
  const sb = createClient(SB_URL, ANON)
  await sb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  await sb.from('profiles').upsert({
    id: session.user.id,
    first_name: 'Tbl',
    last_name: 'Create',
    age: 28,
    verified: true,
    photo_face_ok: true,
  })

  // TEST 1 — tomorrow 8pm local
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(20, 0, 0, 0)
  const tDate = localDateInputValue(tomorrow)
  const tTime = '20:00'
  const tIso = buildEventDatetime(tDate, tTime)
  const { data: t1, error: e1 } = await insertTable(sb, session.user.id, {
    event_datetime: tIso,
    title: `Tomorrow8pm-${ts}`,
  })
  pass('TEST 1 insert tomorrow 8pm', !e1 && !!t1?.id, e1?.message)
  pass('TEST 1 stored event_datetime matches', t1?.event_datetime?.startsWith(tIso.slice(0, 16)))

  // TEST 2 — later today (+3h rounded hour)
  const later = new Date()
  later.setHours(later.getHours() + 3, 0, 0, 0)
  const lIso = buildEventDatetime(localDateInputValue(later), `${String(later.getHours()).padStart(2, '0')}:00`)
  const { data: t2, error: e2 } = await insertTable(sb, session.user.id, {
    event_datetime: lIso,
    title: `LaterToday-${ts}`,
  })
  pass('TEST 2 insert later today', !e2 && !!t2?.id, e2?.message)
  pass('TEST 2 formatEventTime label', formatEventTime(t2?.event_datetime)?.length > 3)

  // TEST 3 — past blocked (RLS)
  const pastIso = new Date(Date.now() - 3600_000).toISOString()
  const { error: e3 } = await insertTable(sb, session.user.id, {
    event_datetime: pastIso,
    title: `Past-${ts}`,
  })
  pass('TEST 3 past insert rejected', !!e3, e3?.message)
  const mapped = mapError(e3)
  pass('TEST 3 mapped error is specific', !mapped.includes('Diçka shkoi keq') || mapped.includes('datën'))

  // Missing event_datetime → RLS
  const { error: e4 } = await sb.from('tables').insert({
    kind: 'tavoline',
    category: 'kafe',
    title: `NoDT-${ts}`,
    area: 'Q',
    city: 'Prishtinë',
    time_label: 'x',
    spots: 4,
    langs: ['sq'],
    description: 'x',
    host_id: session.user.id,
  }).select('id').single()
  pass('missing event_datetime rejected', !!e4, `${e4?.code} ${e4?.message}`)

  console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll tests PASS')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
