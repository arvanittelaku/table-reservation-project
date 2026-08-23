/**
 * Reproduce table creation failure — prints raw Supabase error.
 * Run: node scripts/repro-table-create.mjs
 */
import { createClient } from '@supabase/supabase-js'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const ts = Date.now()

async function signup() {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `table-create-${ts}@test.local`,
      password: 'TestPass123!',
      data: { first_name: 'Table', last_name: 'Test', age: 28 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(JSON.stringify(data))
  return data
}

function futureLocalIso(hoursAhead = 3) {
  const d = new Date()
  d.setHours(d.getHours() + hoursAhead, 0, 0, 0)
  const eventDate = d.toISOString().split('T')[0]
  const eventTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const eventDatetime = new Date(`${eventDate}T${eventTime}`).toISOString()
  return { eventDate, eventTime, eventDatetime }
}

async function main() {
  const session = await signup()
  const sb = createClient(SB_URL, ANON)
  await sb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })

  await sb.from('profiles').upsert({
    id: session.user.id,
    first_name: 'Table',
    last_name: 'Test',
    age: 28,
    verified: true,
    photo_face_ok: true,
  })

  const { eventDate, eventTime, eventDatetime } = futureLocalIso(3)
  console.log('Local inputs:', { eventDate, eventTime, eventDatetime, now: new Date().toISOString() })

  const payload = {
    kind: 'tavoline',
    category: 'kafe',
    title: `ReproCafe-${ts}`,
    area: 'Qendra',
    city: 'Prishtinë',
    time_label: 'Test',
    event_datetime: eventDatetime,
    starts_at: eventDatetime,
    spots: 4,
    langs: ['sq'],
    tags: [],
    description: 'Repro test table',
    host_id: session.user.id,
  }

  console.log('Insert payload:', JSON.stringify(payload, null, 2))

  const { data, error, status, statusText } = await sb.from('tables').insert(payload).select('id, event_datetime, langs').single()

  console.log('HTTP status:', status, statusText)
  console.log('Response data:', JSON.stringify(data, null, 2))
  console.log('Response error (raw):', JSON.stringify(error, null, 2))

  if (error) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
