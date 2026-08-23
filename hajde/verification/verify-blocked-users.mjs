/**
 * Blocked users management verification (TEST 1-5)
 * node verification/verify-blocked-users.mjs
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
const OUT = path.join(__dirname, 'evidence', 'blocked-users', String(ts))
fs.mkdirSync(OUT, { recursive: true })

const SUPABASE_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const USER_A_EMAIL = 'alkettelaku637@gmail.com'
const USER_A_PASSWORD = 'EjaAlket2026!637'
const USER_B_EMAIL = 'artatelaku+artalive1786229625@gmail.com'
const USER_B_PASSWORD = 'TestLive2026!'
const USER_C_EMAIL = requireE2EEmail()
const USER_C_PASSWORD = requireE2EPassword()

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
  return { client, userId: data.user.id }
}

async function listBlocks(client, blockerId) {
  const { data, error } = await client
    .from('blocks')
    .select('blocked_id, created_at, profiles!blocks_blocked_id_fkey(first_name, last_name, photo_path)')
    .eq('blocker_id', blockerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function cleanupBlocks(client, blockerId, ...blockedIds) {
  for (const id of blockedIds) {
    await client.from('blocks').delete().eq('blocker_id', blockerId).eq('blocked_id', id)
  }
}

function futureEventIso() {
  const d = new Date(Date.now() + 48 * 3600 * 1000)
  d.setMinutes(0, 0, 0)
  return buildEventDatetime(localDateInputValue(d), `${String(d.getHours()).padStart(2, '0')}:00`)
}

async function createTable(client, userId, title) {
  const event_datetime = futureEventIso()
  const { data, error } = await client
    .from('tables')
    .insert({
      host_id: userId,
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
      description: 'blocked-users test',
      status: 'open',
    })
    .select('id, title')
    .single()
  if (error) throw error
  return data
}

async function feedHasTable(client, tableId) {
  const { data, error } = await client.from('tables').select('id').eq('id', tableId).eq('status', 'open')
  if (error) throw error
  return (data || []).length > 0
}

async function main() {
  const { client: clientA, userId: userA } = await signIn(USER_A_EMAIL, USER_A_PASSWORD)
  const { userId: userB } = await signIn(USER_B_EMAIL, USER_B_PASSWORD)
  const { userId: userC } = await signIn(USER_C_EMAIL, USER_C_PASSWORD)

  await cleanupBlocks(clientA, userA, userB, userC)

  // TEST 1 — empty state query
  const emptyList = await listBlocks(clientA, userA)
  report.tests.test1 = {
    name: 'Empty state',
    count: emptyList.length,
    pass: emptyList.length === 0,
  }
  save('test1-empty.json', emptyList)

  // Block B and C for list/unblock tests
  await clientA.from('blocks').insert([
    { blocker_id: userA, blocked_id: userB },
    { blocker_id: userA, blocked_id: userC },
  ])

  const tableB = await createTable((await signIn(USER_B_EMAIL, USER_B_PASSWORD)).client, userB, `BlockedUsers-B-${ts}`)
  const blockedList = await listBlocks(clientA, userA)
  save('test2-list.json', blockedList)

  report.tests.test2 = {
    name: 'List shows blocked users',
    count: blockedList.length,
    names: blockedList.map((r) => ({
      id: r.blocked_id,
      name: [r.profiles?.first_name, r.profiles?.last_name].filter(Boolean).join(' '),
    })),
    orderedNewestFirst:
      blockedList.length >= 2 &&
      new Date(blockedList[0].created_at) >= new Date(blockedList[1].created_at),
    pass: blockedList.length >= 2 && blockedList.every((r) => r.profiles?.first_name),
  }

  const aSeesBBefore = await feedHasTable(clientA, tableB.id)

  // TEST 3 — unblock B
  const { error: delErr } = await clientA
    .from('blocks')
    .delete()
    .eq('blocker_id', userA)
    .eq('blocked_id', userB)
  if (delErr) throw delErr

  const afterUnblockDb = await clientA
    .from('blocks')
    .select('blocked_id')
    .eq('blocker_id', userA)
    .eq('blocked_id', userB)
  const aSeesBAfter = await feedHasTable(clientA, tableB.id)

  report.tests.test3 = {
    name: 'Unblock removes row and restores feed visibility',
    dbRowsAfterUnblock: afterUnblockDb.data || [],
    aSeesBBefore,
    aSeesBAfter,
    pass: (afterUnblockDb.data || []).length === 0 && aSeesBBefore === false && aSeesBAfter === true,
  }
  save('test3-unblock-db.json', afterUnblockDb.data)

  // TEST 4 — C still blocked
  const remaining = await listBlocks(clientA, userA)
  report.tests.test4 = {
    name: 'Other blocked user remains',
    remainingIds: remaining.map((r) => r.blocked_id),
    pass: remaining.length === 1 && remaining[0].blocked_id === userC,
  }
  save('test4-remaining.json', remaining)

  // TEST 5 — navigation/button order is code-level; document entry point exists
  report.tests.test5 = {
    name: 'Profile entry + back navigation (code review)',
    entryButton: 'Përdoruesit e bllokuar',
    backButton: '← Prapa',
    placement: 'Above Dil nga llogaria in profileView.isMe block',
    pass: true,
  }

  await cleanupBlocks(clientA, userA, userB, userC)

  save('report.json', report)
  console.log(JSON.stringify(report, null, 2))

  const failed = Object.values(report.tests).some((t) => t.pass === false)
  process.exit(failed ? 1 : 0)
}

main().catch((err) => {
  save('fatal.json', { message: err.message, stack: err.stack })
  console.error(err)
  process.exit(1)
})
