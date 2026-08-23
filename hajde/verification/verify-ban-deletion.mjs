/**
 * Isolated 3-strike ban deletion test (signUp user, admin_ban_from_report).
 * Run: SUPABASE_SERVICE_ROLE_KEY='...' node verification/verify-ban-deletion.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SB = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const ADMIN_EMAIL = 'ejabashkohu@gmail.com'
const ADMIN_PASSWORD = 'ejaBashkohu1@@'
const PASSWORD = 'TestPass123!'

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || ''

async function signup(email) {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { first_name: 'Ban', last_name: 'Del', age: 28 },
    }),
  })
  const data = await res.json()
  if (!data.user?.id) throw new Error(JSON.stringify(data))
  return data
}

async function login(email, password) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(JSON.stringify(data))
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

async function counts(serviceKey, userId) {
  const admin = createClient(SB, serviceKey)
  const { count: profileCount } = await admin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('id', userId)
  const authRes = await fetch(`${SB}/auth/v1/admin/users/${userId}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
  return {
    profile_count: profileCount ?? null,
    auth_status: authRes.status,
  }
}

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}

const ts = Date.now()
const banEmail = `ejabashkohu+banverify.${ts}@gmail.com`
const out = path.join(__dirname, 'evidence', 'ban-deletion-verify', String(ts))
fs.mkdirSync(out, { recursive: true })

;(async () => {
  const banSess = await signup(banEmail)
  const banTargetId = banSess.user.id
  const adminSess = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const adminRpc = await sbClient(adminSess)

  const steps = []
  for (let i = 1; i <= 3; i += 1) {
    const rep = await signup(`ejabashkohu+banrep${i}.${ts}@gmail.com`)
    const rc = await sbClient(rep)
    await rc.from('reports').insert({
      reporter_id: rep.user.id,
      reported_id: banTargetId,
      reason: `Verify ban ${i}`,
    })
    await new Promise((r) => setTimeout(r, 600))
    const { data: pending } = await adminRpc.rpc('admin_get_reports', { p_status: 'pending' })
    const row = (pending || []).find((r) => r.reported_id === banTargetId)
    if (!row) throw new Error(`no pending report on step ${i}`)
    const { data: banCount, error } = await adminRpc.rpc('admin_ban_from_report', {
      p_report_id: row.id,
      p_reason: row.reason,
    })
    if (error) throw error
    steps.push({ step: i, banCount })
  }

  let final = null
  for (let poll = 0; poll < 20; poll += 1) {
    final = await counts(SERVICE_KEY, banTargetId)
    if (final.profile_count === 0 && final.auth_status === 404) break
    await new Promise((r) => setTimeout(r, 2000))
  }

  const pass = final?.profile_count === 0 && final?.auth_status === 404
  const report = { banTargetId, banEmail, steps, final, pass }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2))

  // pg_net: run this in SQL Editor after the test (CLI cannot query net schema here):
  console.log('\n--- pg_net check (paste in SQL Editor) ---')
  console.log(`SELECT id, status_code, content, created
FROM net._http_response
WHERE content ILIKE '%delete-banned-user%'
   OR (status_code = 200 AND content = 'ok')
ORDER BY id DESC
LIMIT 5;`)

  console.log(JSON.stringify(report, null, 2))
  console.log(pass ? '\nPASS' : '\nFAIL')
  process.exit(pass ? 0 : 1)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
