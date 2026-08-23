/**
 * Verify SMTP on production: notify-ban, notify-email (join), password reset.
 * Run: node verification/verify-smtp-live.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { localDateInputValue, buildEventDatetime } from '../src/lib/eventSchedule.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SB = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const PASSWORD = 'TestPass123!'
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'smtp-verify', String(ts))
fs.mkdirSync(OUT, { recursive: true })

function dbQuery(sql) {
  const raw = execSync(`npx supabase db query --linked ${JSON.stringify(sql)}`, {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`Unexpected db output:\n${raw}`)
  return JSON.parse(raw.slice(start, end + 1))
}

async function signup(email, first = 'SMTP', last = 'Test') {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { first_name: first, last_name: last, age: 28 },
    }),
  })
  const data = await res.json()
  if (!data.user?.id) throw new Error(`signup failed: ${JSON.stringify(data)}`)
  return data
}

async function login(email, password = PASSWORD) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`login failed: ${JSON.stringify(data)}`)
  return data
}

async function sbClient(session) {
  const c = createClient(SB, ANON)
  const { error } = await c.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (error) throw error
  return c
}

function latestPgNet(limit = 8) {
  return dbQuery(
    `select id, status_code, content, created from net._http_response order by id desc limit ${limit}`,
  ).rows
}

function pgNetAfter(minId, limit = 10) {
  return dbQuery(
    `select id, status_code, content, created from net._http_response where id > ${minId} order by id asc limit ${limit}`,
  ).rows
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

;(async () => {
  const report = { ts, tests: {} }

  const baselineMaxId = latestPgNet(1)[0]?.id ?? 0
  report.baseline_pg_net_max_id = baselineMaxId

  // TEST 1 — notify-ban via ban_user()
  const banEmail = `ejabashkohu+bantest.${ts}@gmail.com`
  const banUser = await signup(banEmail, 'Ban', 'SMTP')
  const banUserId = banUser.user.id
  report.tests.test1 = { banEmail, banUserId }

  const banResult = dbQuery(
    `select public.ban_user('${banUserId}'::uuid, 'SMTP verification test') as ban_count`,
  )
  report.tests.test1.ban_user_result = banResult.rows[0]

  await sleep(8000)
  const t1Rows = pgNetAfter(baselineMaxId, 6)
  report.tests.test1.pg_net = t1Rows
  report.tests.test1.notify_ban_rows = t1Rows.filter((r) =>
    String(r.content || '').includes('notify-ban') ||
    String(r.content || '').includes('pezull') ||
    String(r.content || '').includes('"ok":true') ||
    String(r.content || '').includes('skipped'),
  )
  // Prefer rows that look like notify-ban (not delete-banned-user "ok")
  const banLike = t1Rows.filter((r) => {
    const c = String(r.content || '')
    return c.includes('skipped') || (c.includes('"ok":true') && c !== 'ok')
  })
  report.tests.test1.notify_ban_candidate = banLike[0] || t1Rows.find((r) => r.content !== 'ok') || t1Rows[0]

  const t1MaxId = t1Rows.at(-1)?.id ?? baselineMaxId

  // TEST 2 — join request → notify-email
  const hostEmail = `ejabashkohu+smtphost.${ts}@gmail.com`
  const guestEmail = `ejabashkohu+smtpguest.${ts}@gmail.com`
  await signup(hostEmail, 'Host', 'SMTP')
  await signup(guestEmail, 'Guest', 'SMTP')
  const hostSess = await login(hostEmail)
  const guestSess = await login(guestEmail)
  const hostClient = await sbClient(hostSess)
  const guestClient = await sbClient(guestSess)
  const hostId = hostSess.user.id

  const future = new Date()
  future.setDate(future.getDate() + 2)
  const eventDatetime = buildEventDatetime(localDateInputValue(future), '20:00')
  const { data: table, error: tableErr } = await hostClient
    .from('tables')
    .insert({
      host_id: hostId,
      kind: 'tavoline',
      category: 'kafe',
      title: `SMTP-Join-${ts}`,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: '20:00',
      event_datetime: eventDatetime,
      spots: 4,
      langs: ['sq'],
      tags: [],
      status: 'open',
    })
    .select('id')
    .single()
  if (tableErr) throw tableErr

  const beforeJoinMax = latestPgNet(1)[0]?.id ?? t1MaxId
  const { data: reqId, error: joinErr } = await guestClient.rpc('request_join', {
    p_table: table.id,
  })
  if (joinErr) throw joinErr

  await sleep(8000)
  const t2Rows = pgNetAfter(beforeJoinMax, 6)
  report.tests.test2 = {
    hostEmail,
    guestEmail,
    tableId: table.id,
    requestId: reqId,
    pg_net: t2Rows,
  }

  // TEST 3 — password reset (Supabase Auth SMTP path)
  const resetEmail = `ejabashkohu+smtpreset.${ts}@gmail.com`
  await signup(resetEmail, 'Reset', 'SMTP')
  const resetRes = await fetch(`${SB}/auth/v1/recover`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: resetEmail }),
  })
  const resetBody = await resetRes.json().catch(() => ({}))
  report.tests.test3 = {
    resetEmail,
    http_status: resetRes.status,
    response: resetBody,
    note:
      'Auth SMTP sends directly via GoTrue — not logged in pg_net. Inbox sender/subject must be checked manually.',
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
