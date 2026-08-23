/**
 * Verify request_join expiry guard (regression fix for migration 20260823172000).
 *
 * Run BEFORE fix: documents RPC bypass on expired tables.
 * Run AFTER fix:  RPC must reject with 'Kjo tavolinë ka skaduar'.
 *
 * Usage: node verification/verify-request-join-expiry-restore.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'request-join-expiry-restore', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const HOST_EMAIL = process.env.E2E_EMAIL || 'ejabashkohu@gmail.com'
const HOST_PASSWORD = process.env.E2E_PASSWORD || 'ejaBashkohu1@@'
const GUEST_EMAIL = process.env.GAP_GUEST_EMAIL || 'ultreuvl@guerrillamailblock.com'
const GUEST_PASSWORD = process.env.GAP_GUEST_PASSWORD || 'TestPass123!'

async function login(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`login failed ${email}: ${JSON.stringify(data)}`)
  return data
}

function client(session) {
  const c = createClient(SB_URL, ANON)
  return c.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }).then(({ error }) => {
    if (error) throw error
    return c
  })
}

async function main() {
  const report = { ts, outDir: OUT, verifiedAt: new Date().toISOString() }

  const hostSession = await login(HOST_EMAIL, HOST_PASSWORD)
  const guestSession = await login(GUEST_EMAIL, GUEST_PASSWORD)
  const host = await client(hostSession)
  const guest = await client(guestSession)

  const eventDatetime = new Date(Date.now() + 70_000).toISOString()
  const { data: table, error: insErr } = await host
    .from('tables')
    .insert({
      host_id: hostSession.user.id,
      kind: 'tavoline',
      category: 'kafe',
      title: `ExpiryRestore-${ts}`,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: 'Test',
      event_datetime: eventDatetime,
      starts_at: eventDatetime,
      spots: 4,
      langs: ['sq'],
      tags: [],
      description: 'request_join expiry restore test',
      status: 'open',
      maps_link: 'https://www.google.com/maps/search/?api=1&query=Test',
    })
    .select('id, event_datetime')
    .single()

  if (insErr) throw new Error(`table insert: ${insErr.message}`)
  report.table = table

  console.log(`Table ${table.id} scheduled ${table.event_datetime}; waiting 75s for natural expiry…`)
  await new Promise((r) => setTimeout(r, 75_000))

  const { data: guestFeed } = await guest.from('tables').select('id').eq('id', table.id)
  const { data: hostFeed } = await host.from('tables').select('id, event_datetime').eq('id', table.id)

  const { data: rpcData, error: rpcErr } = await guest.rpc('request_join', { p_table: table.id })
  const { error: directInsErr } = await guest.from('requests').insert({
    table_id: table.id,
    user_id: guestSession.user.id,
  })

  report.feed = {
    guestVisible: (guestFeed?.length || 0) > 0,
    hostVisible: (hostFeed?.length || 0) > 0,
    hostEventDatetime: hostFeed?.[0]?.event_datetime || null,
  }
  report.rpc = {
    success: !!rpcData,
    requestId: rpcData || null,
    rawError: rpcErr?.message || null,
    code: rpcErr?.code || null,
  }
  report.directInsert = {
    blocked: !!directInsErr,
    code: directInsErr?.code || null,
    message: directInsErr?.message || null,
  }

  const rpcGuardOk =
    !!rpcErr &&
    (rpcErr.message.includes('skaduar') || rpcErr.message.includes('Kjo tavolinë ka skaduar'))
  const rlsGuardOk = !!directInsErr && directInsErr.code === '42501'
  const feedOk = !report.feed.guestVisible && report.feed.hostVisible

  report.expectedAfterFix = {
    rpcRejectedWithSkaduar: rpcGuardOk,
    directInsertBlockedByRls: rlsGuardOk,
    expiredHiddenFromGuestFeed: feedOk,
  }
  report.pass = rpcGuardOk && rlsGuardOk && feedOk

  report.regressionState = report.rpc.success
    ? 'VULNERABLE — request_join accepts expired tables (expiry guard missing from RPC)'
    : rpcGuardOk
      ? 'FIXED — request_join rejects expired tables'
      : 'UNKNOWN — unexpected RPC error'

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  console.log(`Evidence: ${OUT}`)
  process.exit(report.pass ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
