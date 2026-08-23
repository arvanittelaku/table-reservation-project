/**
 * Reproduce apiCreateTable path — insert + joined select (matches tables.js).
 */
import { createClient } from '@supabase/supabase-js'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const HOST_SELECT = `
  id,
  first_name,
  last_name,
  age,
  photo_path,
  verified,
  rating,
  tables_hosted
`

const ts = Date.now()

async function signup() {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `table-api-${ts}@test.local`,
      password: 'TestPass123!',
      data: { first_name: 'Api', last_name: 'Test', age: 28 },
    }),
  })
  return res.json()
}

async function main() {
  const session = await signup()
  if (!session.access_token) throw new Error(JSON.stringify(session))
  const sb = createClient(SB_URL, ANON)
  await sb.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })

  await sb.from('profiles').upsert({
    id: session.user.id,
    first_name: 'Api',
    last_name: 'Test',
    age: 28,
    verified: true,
    photo_face_ok: true,
  })

  const d = new Date()
  d.setHours(d.getHours() + 3, 0, 0, 0)
  const eventDate = d.toISOString().split('T')[0]
  const eventTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const eventDatetime = new Date(`${eventDate}T${eventTime}`).toISOString()

  const formData = {
    kind: 'tavoline',
    category: 'kafe',
    title: `ApiCafe-${ts}`,
    area: 'Qendra',
    city: 'Prishtinë',
    time_label: 'Sot, 19:00',
    event_datetime: eventDatetime,
    starts_at: eventDatetime,
    spots: 4,
    langs: ['sq'],
    tags: [],
    description: 'Api path test',
  }

  const { data, error } = await sb
    .from('tables')
    .insert({ ...formData, host_id: session.user.id })
    .select(
      `
      *,
      host:profiles!tables_host_id_fkey (${HOST_SELECT}),
      memberships (
        user_id,
        role,
        profile:profiles!memberships_user_id_fkey ( id, first_name, last_name, age, photo_path )
      ),
      requests ( id, user_id, status ),
      waitlist ( user_id )
    `,
    )
    .single()

  console.log('error (raw):', JSON.stringify(error, null, 2))
  console.log('data id:', data?.id)
  if (error) process.exit(1)
}

main().catch(console.error)
