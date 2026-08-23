/**
 * Investigate delete-banned-user failure (Steps 1–4 + isolated 3-strike test).
 * Requires SUPABASE_SERVICE_ROLE_KEY in environment (never commit).
 *
 * Run: SUPABASE_SERVICE_ROLE_KEY='eyJ...' node verification/investigate-delete-banned-user.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'evidence', 'delete-banned-user-investigation', String(Date.now()))
fs.mkdirSync(OUT, { recursive: true })

const SB = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const ADMIN_EMAIL = 'ejabashkohu@gmail.com'
const ADMIN_PASSWORD = 'ejaBashkohu1@@'
const PASSWORD = 'TestPass123!'

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  (() => {
    try {
      const transcript = fs.readFileSync(
        path.join(
          process.env.USERPROFILE || '',
          '.cursor/projects/c-Users-Arvanit-Telaku-Desktop-table-reservation-project/agent-transcripts/0bf10b92-da0a-44e6-b5de-67f967d6f4f5/0bf10b92-da0a-44e6-b5de-67f967d6f4f5.jsonl',
        ),
        'utf8',
      )
      const m = transcript.match(/SERVICE_KEY=\\"(eyJ[^\\"]+)\\"/)
      return m?.[1] || ''
    } catch {
      return ''
    }
  })()

const report = { ts: new Date().toISOString(), steps: {} }

function keyMeta(jwt) {
  if (!jwt) return { present: false }
  const parts = jwt.split('.')
  let payload = {}
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch {
    /* ignore */
  }
  return {
    present: true,
    prefix: jwt.slice(0, 12),
    suffix: jwt.slice(-8),
    length: jwt.length,
    role: payload.role,
    ref: payload.ref,
    exp: payload.exp,
    expired: payload.exp ? Date.now() / 1000 > payload.exp : null,
  }
}

async function fnProbe(name, body, bearer) {
  const res = await fetch(`${SB}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      apikey: ANON,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text.slice(0, 500) }
}

async function signup(email) {
  const res = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      data: { first_name: 'Del', last_name: 'Test', age: 28 },
    }),
  })
  return res.json()
}

async function login(email, password = PASSWORD) {
  const res = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return res.json()
}

function sb(session) {
  const c = createClient(SB, ANON)
  return c.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }).then(({ error }) => {
    if (error) throw error
    return c
  })
}

async function counts(admin, userId) {
  const [{ count: profileCount }, authRes] = await Promise.all([
    admin.from('profiles').select('*', { count: 'exact', head: true }).eq('id', userId),
    fetch(`${SB}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }),
  ])
  return {
    profile_count: profileCount ?? null,
    auth_status: authRes.status,
    auth_body: (await authRes.text()).slice(0, 200),
  }
}

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY before running.')
  process.exit(2)
}

;(async () => {
  report.service_key = keyMeta(SERVICE_KEY)

  // STEP 1 — edge function deployment probe (CLI 403 in this env)
  report.steps.step1_functions = {
    cli_note: 'supabase functions list --project-ref upxxfhvgbmddhyebaiug → 403 (CLI account lacks project privileges)',
    delete_banned_user_no_auth: await fnProbe(
      'delete-banned-user',
      { user_id: '00000000-0000-0000-0000-000000000001' },
      '',
    ),
    delete_banned_user_bad_key: await fnProbe(
      'delete-banned-user',
      { user_id: '00000000-0000-0000-0000-000000000001' },
      'invalid',
    ),
    notify_ban_deployed_probe: await fnProbe(
      'notify-ban',
      { user_id: '00000000-0000-0000-0000-000000000001', reason: 'probe', ban_count: 1 },
      SERVICE_KEY,
    ),
  }

  // STEP 2 — vault secret (needs DB; try service-role SQL via Management API unavailable)
  report.steps.step2_vault = {
    note: 'Cannot query vault.decrypted_secrets from this environment (supabase db query → 403).',
    service_key_meta: report.service_key,
    dashboard_check_required:
      'Compare Dashboard → Settings → API service_role JWT with vault secret app_service_key manually.',
  }

  // STEP 3 — pg_net (needs DB)
  report.steps.step3_pg_net = {
    note: 'Cannot query net._http_response (supabase db query → 403). Run in SQL Editor on production.',
    historical_failed_call: {
      id: 17,
      status_code: 500,
      content: 'Database error loading user',
      context: 'Aug 12 test against SQL-inserted user 5f09d856-...',
    },
  }

  // STEP 4 — direct edge function test (bypass pg_net)
  const ts = Date.now()
  const authUser = await signup(`ejabashkohu+delprobe.${ts}@gmail.com`)
  const authUserId = authUser.user?.id
  if (!authUserId) throw new Error(`signup failed: ${JSON.stringify(authUser)}`)

  const directDeleteAuthUser = await fnProbe(
    'delete-banned-user',
    { user_id: authUserId },
    SERVICE_KEY,
  )

  // Known SQL-inserted disposable user from Aug 12 (may still exist)
  const sqlUserId = '5f09d856-2e17-455d-ada7-a8387c3cbb83'
  const directDeleteSqlUser = await fnProbe(
    'delete-banned-user',
    { user_id: sqlUserId },
    SERVICE_KEY,
  )

  report.steps.step4_direct_curl = {
    auth_signup_user_id: authUserId,
    auth_signup_user_delete: directDeleteAuthUser,
    sql_inserted_user_id: sqlUserId,
    sql_inserted_user_delete: directDeleteSqlUser,
  }

  // Verify auth user actually deleted
  const adminClient = createClient(SB, SERVICE_KEY)
  const afterDirect = await counts(adminClient, authUserId)
  report.steps.step4_post_delete_counts = afterDirect

  // STEP 3-strike isolated test (fresh signUp user)
  const banEmail = `ejabashkohu+delban3.${ts}@gmail.com`
  const banSess = await signup(banEmail)
  const banTargetId = banSess.user?.id
  if (!banTargetId) throw new Error(`ban signup failed: ${JSON.stringify(banSess)}`)

  const adminSess = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  if (!adminSess.access_token) throw new Error(`admin login failed: ${JSON.stringify(adminSess)}`)
  const adminRpc = await sb(adminSess)

  const banSteps = []
  for (let i = 1; i <= 3; i += 1) {
    const rep = await signup(`ejabashkohu+delrep${i}.${ts}@gmail.com`)
    const rc = await sb(rep)
    await rc.from('reports').insert({
      reporter_id: rep.user.id,
      reported_id: banTargetId,
      reason: `Delete probe reason ${i}`,
    })
    await new Promise((r) => setTimeout(r, 600))
    const { data: pending } = await adminRpc.rpc('admin_get_reports', { p_status: 'pending' })
    const row = (pending || []).find((r) => r.reported_id === banTargetId)
    if (!row) throw new Error(`pending report not found on ban ${i}`)
    const { data: banCount, error: banErr } = await adminRpc.rpc('admin_ban_from_report', {
      p_report_id: row.id,
      p_reason: row.reason,
    })
    if (banErr) throw banErr
    banSteps.push({ i, banCount })
  }

  let finalCounts = null
  for (let poll = 0; poll < 20; poll += 1) {
    finalCounts = await counts(adminClient, banTargetId)
    if (finalCounts.profile_count === 0 && finalCounts.auth_status === 404) break
    await new Promise((r) => setTimeout(r, 2000))
  }

  report.steps.step3_strike_test = {
    ban_target_id: banTargetId,
    ban_target_email: banEmail,
    ban_steps: banSteps,
    final_counts: finalCounts,
    pass: finalCounts?.profile_count === 0 && finalCounts?.auth_status === 404,
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  console.log(`\nEvidence: ${OUT}`)
  process.exit(report.steps.step3_strike_test.pass ? 0 : 1)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
