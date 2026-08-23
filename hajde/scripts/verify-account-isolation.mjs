/**
 * Verify account isolation: host_id + no cross-account table association.
 * Run: node scripts/verify-account-isolation.mjs
 *
 * Test A (form pre-fill) is React local state — fixed by resetting form in resetLocalUserState().
 */
import { createClient } from '@supabase/supabase-js'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const ts = Date.now()

function client() {
  return createClient(SB_URL, ANON)
}

async function setSession(c, session) {
  const { error } = await c.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (error) throw error
}

async function signup(email, firstName, lastName) {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'TestPass123!',
      data: { first_name: firstName, last_name: lastName, age: 28 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(JSON.stringify(data))
  return data
}

function futureIso(hours = 3) {
  return new Date(Date.now() + hours * 3600_000).toISOString()
}

async function createTable(c, hostId, title) {
  return c.from('tables').insert({
    kind: 'tavoline',
    category: 'kafe',
    title,
    area: 'Qendra',
    city: 'Prishtinë',
    time_label: 'Test',
    event_datetime: futureIso(),
    spots: 4,
    langs: ['sq'],
    tags: [],
    description: 'Isolation test table',
    host_id: hostId,
  }).select('id, host_id, title').single()
}

async function main() {
  console.log('=== TEST B: host_id matches creating account ===')
  const emailB = `iso-b-${ts}@test.local`
  const emailC = `iso-c-${ts}@test.local`
  const sessB = await signup(emailB, 'Account', 'B')
  const sessC = await signup(emailC, 'Account', 'C')
  const userBId = sessB.user.id
  const userCId = sessC.user.id

  const clientB = client()
  await setSession(clientB, sessB)
  const marker = `IsolationTable-${ts}`
  const { data: table, error } = await createTable(clientB, userBId, marker)
  if (error) throw error

  console.log('createdTable:', JSON.stringify(table))
  console.log('accountBId:', userBId)
  console.log('host_idMatchesB:', table.host_id === userBId)

  console.log('\n=== TEST C: guest sees Account B host profile ===')
  const guest = client()
  await setSession(guest, sessC)
  const { data: guestView, error: guestErr } = await guest
    .from('tables')
    .select(`
      id, host_id, title,
      host:profiles!tables_host_id_fkey ( id, first_name, last_name )
    `)
    .eq('id', table.id)
    .single()
  if (guestErr) throw guestErr

  console.log('guestView:', JSON.stringify(guestView))
  const passB = table.host_id === userBId
  const passC =
    guestView.host_id === userBId &&
    guestView.host?.id === userBId &&
    guestView.host?.first_name === 'Account' &&
    guestView.host?.last_name === 'B'

  console.log('\n=== SUMMARY ===')
  console.log('TEST B (host_id):', passB ? 'PASS' : 'FAIL')
  console.log('TEST C (host display):', passC ? 'PASS' : 'FAIL')
  console.log('TEST A (form pre-fill): CODE FIX — resetLocalUserState() now resets create-table form')

  process.exit(passB && passC ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
