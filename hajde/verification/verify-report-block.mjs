/**
 * Report vs block verification (TEST 1-4)
 * node verification/verify-report-block.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildEventDatetime, localDateInputValue } from '../src/lib/eventSchedule.js'
import { formatEventTime } from '../src/lib/formatEventTime.js'
import { requireE2EEmail, requireE2EPassword } from '../scripts/_requireE2EEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'report-block', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const ADMIN_EMAIL = requireE2EEmail()
const ADMIN_PASSWORD = requireE2EPassword()
const USER_A_EMAIL = process.env.USER_A_EMAIL || 'alkettelaku637@gmail.com'
const USER_A_PASSWORD = process.env.USER_A_PASSWORD || 'EjaAlket2026!637'
const USER_B_EMAIL = process.env.USER_B_EMAIL || 'artatelaku+artalive1786229625@gmail.com'
const USER_B_PASSWORD = process.env.USER_B_PASSWORD || 'TestLive2026!'

const report = { ts, outDir: OUT, tests: {} }

function save(name, obj) {
  fs.writeFileSync(path.join(OUT, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2))
}

function sb() {
  return createClient(SUPABASE_URL, ANON_KEY)
}

async function signIn(email, password) {
  const client = sb()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return { client, userId: data.user.id, session: data.session }
}

async function cleanupPair(clientA, userA, userB) {
  await clientA.from('blocks').delete().eq('blocker_id', userA).eq('blocked_id', userB)
  await clientA.from('blocks').delete().eq('blocker_id', userB).eq('blocked_id', userA)
}

function futureEventIso(hoursAhead = 48) {
  const d = new Date(Date.now() + hoursAhead * 60 * 60 * 1000)
  d.setMinutes(0, 0, 0)
  const date = localDateInputValue(d)
  const time = `${String(d.getHours()).padStart(2, '0')}:00`
  return buildEventDatetime(date, time)
}

async function createOpenTable(client, userId, title) {
  const event_datetime = futureEventIso()
  const { data, error } = await client
    .from('tables')
    .insert({
      host_id: userId,
      kind: 'tavoline',
      title,
      city: 'Prishtinë',
      area: 'Qendra',
      category: 'kafe',
      time_label: formatEventTime(event_datetime),
      event_datetime,
      starts_at: event_datetime,
      spots: 4,
      langs: ['sq'],
      tags: [],
      description: 'verify-report-block',
      status: 'open',
    })
    .select('id, host_id, title')
    .single()
  if (error) throw error
  return data
}

async function feedHasTable(client, tableId) {
  const { data, error } = await client.from('tables').select('id').eq('id', tableId).eq('status', 'open')
  if (error) throw error
  return (data || []).length > 0
}

async function getBlocks(client, blockerId, blockedId) {
  const { data, error } = await client
    .from('blocks')
    .select('*')
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId)
  if (error) throw error
  return data || []
}

async function main() {
  const { client: clientA, userId: userA } = await signIn(USER_A_EMAIL, USER_A_PASSWORD)
  const { client: clientB, userId: userB } = await signIn(USER_B_EMAIL, USER_B_PASSWORD)

  await cleanupPair(clientA, userA, userB)

  save('users.json', { userA, userB, emailA: USER_A_EMAIL, emailB: USER_B_EMAIL })

  const table = await createOpenTable(clientB, userB, `RB-Test-${ts}`)
  save('table.json', table)

  // TEST 1 — report alone does NOT block
  const { data: repRow, error: repErr } = await clientA.from('reports').insert({
    reporter_id: userA,
    reported_id: userB,
    reason: 'Sjellje e papërshtatshme',
    table_id: table.id,
  }).select('*').single()
  if (repErr) throw repErr

  const blocksAfterReport = await getBlocks(clientA, userA, userB)
  const aSeesBAfterReport = await feedHasTable(clientA, table.id)

  report.tests.test1 = {
    name: 'Report alone does not block',
    reportRow: repRow,
    blocksAfterReport,
    aSeesBAfterReport,
    pass: blocksAfterReport.length === 0 && aSeesBAfterReport === true,
  }
  save('test1-report-row.json', repRow)
  save('test1-blocks-after-report.json', blocksAfterReport)

  // TEST 2 — block hides feed + rejects direct join insert
  const { error: blockErr } = await clientA.from('blocks').insert({
    blocker_id: userA,
    blocked_id: userB,
  })
  if (blockErr && blockErr.code !== '23505') throw blockErr

  const blocksAfterBlock = await getBlocks(clientA, userA, userB)
  const aSeesBAfterBlock = await feedHasTable(clientA, table.id)

  const { data: joinRow, error: joinErr } = await clientA.from('requests').insert({
    table_id: table.id,
    user_id: userA,
  }).select('*')

  report.tests.test2 = {
    name: 'Block hides tables and rejects direct requests.insert',
    blocksAfterBlock,
    aSeesBAfterBlock,
    joinInsert: { data: joinRow, error: joinErr ? { code: joinErr.code, message: joinErr.message } : null },
    pass:
      blocksAfterBlock.length >= 1 &&
      aSeesBAfterBlock === false &&
      !!joinErr &&
      joinRow == null,
  }
  save('test2-blocks.json', blocksAfterBlock)
  save('test2-join-rejected.json', { data: joinRow, error: joinErr })

  const { error: rpcErr } = await clientA.rpc('request_join', { p_table: table.id })
  report.tests.test2.requestJoinRpc = rpcErr ? { message: rpcErr.message } : null
  report.tests.test2.pass = report.tests.test2.pass && !!rpcErr

  // TEST 3 — bidirectional: B also stops seeing A's table
  const tableA = await createOpenTable(clientA, userA, `RB-Reverse-${ts}`)
  const bSeesA = await feedHasTable(clientB, tableA.id)
  report.tests.test3 = {
    name: 'Bidirectional feed hiding',
    tableAId: tableA.id,
    bSeesA,
    pass: bSeesA === false,
  }
  save('test3-b-feed.json', { bSeesA, tableAId: tableA.id })

  // TEST 4 — admin reports still visible
  const admin = sb()
  const { error: adminAuthErr } = await admin.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  if (adminAuthErr) {
    report.tests.test4 = { name: 'Admin reports tab', pass: null, skipped: adminAuthErr.message }
  } else {
    const { data: pending, error: adminErr } = await admin.rpc('admin_get_reports', { p_status: 'pending' })
    const found = (pending || []).some((r) => r.id === repRow.id)
    report.tests.test4 = {
      name: 'Reporting still works for admin',
      adminError: adminErr?.message || null,
      reportFoundInPending: found,
      pass: !adminErr && found,
    }
    save('test4-admin-pending.json', pending?.filter((r) => r.id === repRow.id) || [])
  }

  save('report.json', report)
  console.log(JSON.stringify(report, null, 2))

  await cleanupPair(clientA, userA, userB)

  const failed = Object.values(report.tests).some((t) => t.pass === false)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  save('fatal.json', { message: err.message, stack: err.stack })
  console.error(err)
  process.exit(1)
})
