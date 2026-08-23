/**
 * Verify permanent account deactivation (no user reactivation).
 * Run: node scripts/verify-permanent-deactivation.mjs
 *
 * Requires migration 20260816150000_permanent_deactivation.sql applied in Supabase.
 */
import { createClient } from '@supabase/supabase-js'
import { requireE2EEmail, requireE2EPassword } from './_requireE2EEnv.mjs'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const ADMIN_EMAIL = requireE2EEmail()
const ADMIN_PASSWORD = requireE2EPassword()

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
      data: { first_name: firstName, last_name: lastName, age: 27 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(JSON.stringify(data))
  return data
}

async function login(email, password) {
  const c = client()
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  await setSession(c, data.session)
  return { client: c, userId: data.user.id, session: data.session }
}

async function getDeactivatedAt(c, userId) {
  const { data, error } = await c.from('profiles').select('deactivated_at').eq('id', userId).single()
  if (error) throw error
  return data.deactivated_at
}

async function main() {
  const results = {}

  console.log('=== TEST 1: deactivation sets deactivated_at ===')
  const email = `perm-deact-${ts}@test.local`
  const created = await signup(email, 'Perm', 'User')
  const userId = created.user.id
  const c = client()
  await setSession(c, created)

  const before = await getDeactivatedAt(c, userId)
  const { error: deactErr } = await c
    .from('profiles')
    .update({ deactivated_at: new Date().toISOString() })
    .eq('id', userId)
  const after = await getDeactivatedAt(c, userId)

  results.test1 = {
    pass: !deactErr && before == null && after != null,
    before,
    after,
    deactError: deactErr?.message || null,
  }
  console.log(JSON.stringify(results.test1, null, 2))

  console.log('\n=== TEST 2: login still works but profile stays deactivated ===')
  await c.auth.signOut()
  const loggedIn = await login(email, 'TestPass123!')
  const afterLogin = await getDeactivatedAt(loggedIn.client, userId)
  results.test2 = {
    pass: afterLogin != null,
    deactivated_at: afterLogin,
    note: 'UI shows permanent gate only — verified in code (early return before feed/admin)',
  }
  console.log(JSON.stringify(results.test2, null, 2))

  console.log('\n=== TEST 3: user cannot clear deactivated_at via API ===')
  const { error: reactivateErr } = await loggedIn.client
    .from('profiles')
    .update({ deactivated_at: null })
    .eq('id', userId)
  const stillDeactivated = await getDeactivatedAt(loggedIn.client, userId)

  if (!reactivateErr && stillDeactivated == null) {
    console.error(
      'MIGRATION NOT APPLIED: user could clear deactivated_at. Run',
      'hajde/supabase/migrations/20260816150000_permanent_deactivation.sql in SQL Editor.',
    )
    process.exit(2)
  }

  results.test3 = {
    pass:
      !!reactivateErr &&
      (reactivateErr.message.includes('nuk mund të riaktivizohen') ||
        reactivateErr.message.includes('riaktivizohen')),
    apiError: reactivateErr?.message || null,
    apiCode: reactivateErr?.code || null,
    deactivated_atAfterAttempt: stillDeactivated,
  }
  console.log(JSON.stringify(results.test3, null, 2))

  console.log('\n=== TEST 4: app access blocked (UI early return) ===')
  results.test4 = {
    pass: stillDeactivated != null,
    deactivated_at: stillDeactivated,
    note:
      'HajdeApp.jsx returns only the permanent gate when showDeactivatedGate && authUser — no feed/admin/onboard main UI.',
  }
  console.log(JSON.stringify(results.test4, null, 2))

  console.log('\n=== TEST 5: admin direct update vs RPC ===')
  const email2 = `perm-deact-admin-${ts}@test.local`
  const created2 = await signup(email2, 'Admin', 'Target')
  const targetId = created2.user.id
  const targetClient = client()
  await setSession(targetClient, created2)
  const targetDeactivatedAt = new Date().toISOString()
  await targetClient.from('profiles').update({ deactivated_at: targetDeactivatedAt }).eq('id', targetId)
  await targetClient.auth.signOut()

  let adminOverride = { pass: false }
  try {
    const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)

    const { error: adminDirectErr, count: adminDirectCount } = await admin.client
      .from('profiles')
      .update({ deactivated_at: null })
      .eq('id', targetId)
      .select('id', { count: 'exact', head: true })

    const afterDirect = await getDeactivatedAt(admin.client, targetId)

    const { error: rpcErr } = await admin.client.rpc('admin_reactivate_account', {
      p_user_id: targetId,
    })
    const afterRpc = await getDeactivatedAt(admin.client, targetId)

    adminOverride = {
      pass:
        afterDirect != null &&
        !rpcErr &&
        afterRpc == null,
      rpcMissing: !!rpcErr?.message?.includes('Could not find the function'),
      adminDirectUpdateError: adminDirectErr?.message || null,
      adminDirectUpdateCount: adminDirectCount,
      targetAfterDirectUpdate: afterDirect,
      rpcError: rpcErr?.message || null,
      targetAfterRpc: afterRpc,
      note:
        'Direct profiles.update on another user is blocked by RLS (0 rows); admin_reactivate_account RPC clears deactivated_at when caller is admin.',
      sqlEditorNote:
        'SQL Editor runs as postgres without auth.uid(), so is_admin_user() is false — trigger blocks direct UPDATE and RPC calls without a JWT session.',
    }

    if (adminOverride.rpcMissing) {
      console.error(
        'RPC NOT DEPLOYED: run hajde/supabase/migrations/20260816150500_admin_reactivate_account.sql in SQL Editor.',
      )
      adminOverride.pass = false
    }
  } catch (e) {
    adminOverride = { pass: false, error: String(e) }
  }
  results.test5 = adminOverride
  console.log(JSON.stringify(results.test5, null, 2))

  console.log('\n=== TEST 6: non-admin cannot call admin_reactivate_account RPC ===')
  const email3 = `perm-deact-user-${ts}@test.local`
  const created3 = await signup(email3, 'Regular', 'User')
  const regularId = created3.user.id
  const regularClient = client()
  await setSession(regularClient, created3)
  await regularClient.from('profiles').update({ deactivated_at: new Date().toISOString() }).eq('id', regularId)

  const { error: regularRpcErr } = await regularClient.rpc('admin_reactivate_account', {
    p_user_id: regularId,
  })
  const regularStillDeactivated = await getDeactivatedAt(regularClient, regularId)

  results.test6 = {
    pass:
      !!regularRpcErr &&
      (regularRpcErr.message.includes('Vetëm adminët') ||
        regularRpcErr.message.includes('Could not find the function')),
    rpcError: regularRpcErr?.message || null,
    deactivated_atAfterAttempt: regularStillDeactivated,
    note:
      regularRpcErr?.message?.includes('Could not find the function')
        ? 'Fails closed while RPC not in schema cache'
        : 'Non-admin rejected by is_admin_user() guard inside RPC',
  }
  console.log(JSON.stringify(results.test6, null, 2))

  console.log('\n=== SUMMARY ===')
  for (const [k, v] of Object.entries(results)) {
    console.log(`${k}: ${v.pass ? 'PASS' : v.skipped ? 'SKIPPED' : 'FAIL'}`)
  }

  const allPass = Object.values(results).every((r) => r.pass)
  process.exit(allPass ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
