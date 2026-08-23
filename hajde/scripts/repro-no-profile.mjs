/** Test insert without profile row — common real-user failure mode */
import { createClient } from '@supabase/supabase-js'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const ts = Date.now()

async function main() {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `no-profile-${ts}@test.local`,
      password: 'TestPass123!',
      data: { first_name: 'No', last_name: 'Profile', age: 28 },
    }),
  })
  const session = await res.json()
  if (!session.access_token) throw new Error(JSON.stringify(session))

  const sb = createClient(SB_URL, ANON)
  await sb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })

  const d = new Date()
  d.setHours(d.getHours() + 3, 0, 0, 0)
  const eventDatetime = new Date(`${d.toISOString().split('T')[0]}T${String(d.getHours()).padStart(2, '0')}:00`).toISOString()

  const { error } = await sb.from('tables').insert({
    kind: 'tavoline',
    category: 'kafe',
    title: `NoProf-${ts}`,
    area: 'Qendra',
    city: 'Prishtinë',
    time_label: 'Test',
    event_datetime: eventDatetime,
    spots: 4,
    langs: ['sq'],
    description: 'test',
    host_id: session.user.id,
  }).select('id').single()

  console.log('error without profile upsert:', JSON.stringify(error, null, 2))
}

main().catch(console.error)
