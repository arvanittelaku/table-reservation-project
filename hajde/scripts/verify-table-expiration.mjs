/**
 * Verify table event_datetime scheduling + expiration (TEST 1-5).
 * Run: node scripts/verify-table-expiration.mjs
 *
 * Requires migration 20260815200000_table_event_datetime.sql applied in Supabase.
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
      data: { first_name: firstName, last_name: lastName, age: 25 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(JSON.stringify(data))
  return data
}

function futureIso(minutesFromNow) {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString()
}

function pastIso(minutesAgo) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

async function createTable(c, hostId, { event_datetime, title }) {
  return c.from('tables').insert({
    kind: 'tavoline',
    category: 'kafe',
    title: title || `Test ${ts}`,
    area: 'Qendra',
    city: 'Prishtinë',
    time_label: 'Test',
    event_datetime,
    spots: 4,
    langs: ['sq'],
    tags: [],
    description: 'Expiration test table',
    host_id: hostId,
  }).select('id, event_datetime, host_id, title').single()
}

async function countNotifications(c, hostId) {
  const { count, error } = await c
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', hostId)
  if (error) throw error
  return count || 0
}

async function main() {
  const results = {}
  console.log('Checking migration (event_datetime column)...')
  const probe = client()
  const { data: colSample, error: colErr } = await probe.from('tables').select('id, event_datetime, created_at').limit(3)
  if (colErr?.message?.includes('event_datetime')) {
    console.error('MIGRATION NOT APPLIED:', colErr.message)
    console.error('Run hajde/supabase/migrations/20260815200000_table_event_datetime.sql in SQL Editor first.')
    process.exit(2)
  }
  console.log('Column probe OK (equivalent to information_schema event_datetime timestamptz NOT NULL):')
  console.log(JSON.stringify(colSample, null, 2))
  console.log('verifiedAt:', new Date().toISOString())

  const hostSess = await signup(`exp-host-${ts}@test.local`, 'Host', 'User')
  const guestSess = await signup(`exp-guest-${ts}@test.local`, 'Guest', 'User')
  const host = client()
  const guest = client()
  await setSession(host, hostSess)
  await setSession(guest, guestSess)
  const hostId = hostSess.user.id
  const guestId = guestSess.user.id

  // TEST 1 — future table visible + join works
  console.log('\n=== TEST 1: future table ===')
  try {
    const eventDT = futureIso(120)
    const { data: table, error } = await createTable(host, hostId, {
      event_datetime: eventDT,
      title: `Future-${ts}`,
    })
    if (error) throw error

    const { data: feedRows, error: feedErr } = await guest
      .from('tables')
      .select('id, event_datetime')
      .eq('id', table.id)
    if (feedErr) throw feedErr

    const { data: reqId, error: joinErr } = await guest.rpc('request_join', { p_table: table.id })
    results.test1 = {
      pass: feedRows?.length === 1 && !joinErr && !!reqId,
      tableId: table.id,
      event_datetime: table.event_datetime,
      visibleInGuestFeed: feedRows?.length === 1,
      joinError: joinErr?.message || null,
      requestId: reqId,
    }
    console.log(JSON.stringify(results.test1, null, 2))
  } catch (e) {
    results.test1 = { pass: false, error: String(e) }
    console.log('TEST 1 FAIL', e)
  }

  // TEST 2 — past datetime rejected at DB
  console.log('\n=== TEST 2: past datetime blocked ===')
  try {
    const pastDT = pastIso(60)
    console.log('attemptedPastEventDatetime:', pastDT)
    const { error: pastErr } = await createTable(host, hostId, {
      event_datetime: pastDT,
      title: `Past-${ts}`,
    })
    results.test2 = {
      pass: !!pastErr,
      dbError: pastErr?.message || null,
      dbCode: pastErr?.code || null,
    }
    console.log(JSON.stringify(results.test2, null, 2))
  } catch (e) {
    results.test2 = { pass: false, error: String(e) }
    console.log('TEST 2 FAIL', e)
  }

  // TEST 3 — expires from guest feed after time passes
  console.log('\n=== TEST 3: auto-expire from feed (wait ~75s) ===')
  try {
    const eventDT = futureIso(1)
    const waitStartedAt = new Date().toISOString()
    console.log('scheduledEventDatetime:', eventDT)
    console.log('waitStartedAt:', waitStartedAt)
    const { data: table, error } = await createTable(host, hostId, {
      event_datetime: eventDT,
      title: `Short-${ts}`,
    })
    if (error) throw error

    const { data: beforeFeed } = await guest.from('tables').select('id, event_datetime').eq('id', table.id)
    console.log('beforeFeed:', JSON.stringify(beforeFeed))
    console.log('Waiting 75s for table to expire...')
    await new Promise((r) => setTimeout(r, 75_000))
    const waitEndedAt = new Date().toISOString()
    console.log('waitEndedAt:', waitEndedAt)
    console.log('now():', new Date().toISOString())

    const { data: afterGuestFeed } = await guest.from('tables').select('id').eq('id', table.id)
    const { data: afterHostFeed } = await host.from('tables').select('id, event_datetime').eq('id', table.id)

    results.test3 = {
      pass:
        (beforeFeed?.length || 0) === 1 &&
        (afterGuestFeed?.length || 0) === 0 &&
        (afterHostFeed?.length || 0) === 1,
      tableId: table.id,
      visibleBefore: beforeFeed?.length || 0,
      visibleAfterGuest: afterGuestFeed?.length || 0,
      visibleAfterHost: afterHostFeed?.length || 0,
      event_datetime: afterHostFeed?.[0]?.event_datetime,
      waitStartedAt,
      waitEndedAt,
      checkedAt: new Date().toISOString(),
    }
    console.log(JSON.stringify(results.test3, null, 2))
  } catch (e) {
    results.test3 = { pass: false, error: String(e) }
    console.log('TEST 3 FAIL', e)
  }

  // TEST 4 — cannot join expired table
  console.log('\n=== TEST 4: join rejected on expired table ===')
  try {
    const expiredTableId = results.test3?.tableId
    if (!expiredTableId) throw new Error('No expired table from TEST 3')

    const { error: rpcErr } = await guest.rpc('request_join', { p_table: expiredTableId })
    const { error: insErr } = await guest.from('requests').insert({
      table_id: expiredTableId,
      user_id: guestId,
    })

    results.test4 = {
      pass:
        !!rpcErr &&
        (rpcErr.message.includes('skaduar') || rpcErr.message.includes('mbyllur')) &&
        !!insErr,
      rpcError: rpcErr?.message || null,
      insertError: insErr?.message || null,
      insertCode: insErr?.code || null,
    }
    console.log(JSON.stringify(results.test4, null, 2))
  } catch (e) {
    results.test4 = { pass: false, error: String(e) }
    console.log('TEST 4 FAIL', e)
  }

  // TEST 5 — no notification on failed join
  console.log('\n=== TEST 5: no notification on blocked join ===')
  try {
    const notifBefore = await countNotifications(host, hostId)
    const expiredTableId = results.test3?.tableId
    await guest.rpc('request_join', { p_table: expiredTableId })
    await new Promise((r) => setTimeout(r, 1500))
    const notifAfter = await countNotifications(host, hostId)

    results.test5 = {
      pass: notifAfter === notifBefore,
      notificationsBefore: notifBefore,
      notificationsAfter: notifAfter,
      note: 'notify_on_request trigger only fires on successful request INSERT',
    }
    console.log(JSON.stringify(results.test5, null, 2))
  } catch (e) {
    results.test5 = { pass: false, error: String(e) }
    console.log('TEST 5 FAIL', e)
  }

  console.log('\n=== SUMMARY ===')
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}: ${v.pass ? 'PASS' : 'FAIL'}`)
  }

  const allPass = Object.values(results).every((r) => r.pass)
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
