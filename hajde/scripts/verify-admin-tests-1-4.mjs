/**
 * Admin panel TEST 1-4 verification (post-migration).
 * Run: node scripts/verify-admin-tests-1-4.mjs
 */
import { createClient } from '@supabase/supabase-js'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ejabashkohu@gmail.com'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ejaBashkohu1@@'

async function signup(email, firstName, lastName, password = 'TestPass123!') {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      data: { first_name: firstName, last_name: lastName, age: 25 },
    }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`signup ${email}: ${JSON.stringify(data)}`)
  return data
}

async function clientFor(session) {
  const c = createClient(SB_URL, ANON)
  const { error } = await c.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })
  if (error) throw error
  return c
}

async function login(email, password) {
  const c = createClient(SB_URL, ANON)
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  return { client: await clientFor(data.session), session: data.session, userId: data.user.id }
}

async function waitForProfile(client, userId, attempts = 8) {
  for (let i = 0; i < attempts; i += 1) {
    const { data } = await client.from('profiles').select('id').eq('id', userId).maybeSingle()
    if (data?.id) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

async function ensureProfile(client, userId, firstName, lastName) {
  await client.from('profiles').upsert({
    id: userId,
    first_name: firstName,
    last_name: lastName,
    age: 25,
  })
}

async function main() {
  const ts = Date.now()
  const results = {}

  // ── TEST 1: non-admin RPC blocked ──
  console.log('\n=== TEST 1: non-admin admin_get_stats rejected ===')
  try {
    const nonAdmin = await signup(`t1nonadmin${ts}@test.local`, 'Regular', 'User')
    const naClient = await clientFor(nonAdmin)
    const { data, error } = await naClient.rpc('admin_get_stats', { p_range: 'month' })
    const msg = error?.message || ''
    const { error: banErr } = await naClient.rpc('admin_ban_from_report', {
      p_report_id: '00000000-0000-0000-0000-000000000000',
      p_reason: 'test',
    })
    results.test1 = {
      pass:
        !!error &&
        msg.includes('Vetëm adminët mund ta shohin këtë') &&
        banErr?.message?.includes('Vetëm adminët mund ta bëjnë këtë'),
      rpcError: msg,
      rpcCode: error?.code || null,
      rpcData: data,
      banRpcError: banErr?.message || null,
      expectedMessage: 'Vetëm adminët mund ta shohin këtë',
    }
    console.log(JSON.stringify(results.test1, null, 2))
  } catch (e) {
    results.test1 = { pass: false, error: String(e) }
    console.log('FAIL:', e)
  }

  // ── TEST 2: admin stats + cross-check ──
  console.log('\n=== TEST 2: admin_get_stats real data ===')
  try {
    const { client: adminClient, userId: adminId } = await login(ADMIN_EMAIL, ADMIN_PASSWORD)

    const { data: isAdminRow } = await adminClient
      .from('profiles')
      .select('is_admin')
      .eq('id', adminId)
      .single()

    const { data: statsMonth, error: statsErr } = await adminClient.rpc('admin_get_stats', { p_range: 'month' })
    if (statsErr) throw statsErr

    const { data: statsDay, error: dayErr } = await adminClient.rpc('admin_get_stats', { p_range: 'day' })
    if (dayErr) throw dayErr

    const { data: statsYear, error: yearErr } = await adminClient.rpc('admin_get_stats', { p_range: 'year' })
    if (yearErr) throw yearErr

    // Cross-check: profiles count (public table we can read as admin if policy allows)
    const [
      { count: profilesCount, error: profCountErr },
      { count: tablesCount },
      { count: membershipsCount },
      { count: pendingReportsCount },
      { count: bansCount },
    ] = await Promise.all([
      adminClient.from('profiles').select('*', { count: 'exact', head: true }),
      adminClient.from('tables').select('*', { count: 'exact', head: true }),
      adminClient.from('memberships').select('*', { count: 'exact', head: true }),
      adminClient.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      adminClient.from('bans').select('*', { count: 'exact', head: true }),
    ])

    const totalUsers = statsMonth?.totals?.total_users
    const totals = statsMonth?.totals || {}
    results.test2 = {
      pass:
        isAdminRow?.is_admin === true &&
        typeof totalUsers === 'number' &&
        totalUsers > 0 &&
        totalUsers === profilesCount &&
        totals.total_tables === tablesCount &&
        totals.total_memberships === membershipsCount &&
        totals.pending_reports === pendingReportsCount &&
        totals.total_bans === bansCount &&
        Array.isArray(statsMonth?.new_users),
      adminIsAdmin: isAdminRow?.is_admin,
      adminUserId: adminId,
      statsMonth,
      statsDayBuckets: statsDay?.new_users?.length,
      statsYearBuckets: statsYear?.new_users?.length,
      profilesCountCrossCheck: profilesCount,
      tablesCountCrossCheck: tablesCount,
      membershipsCountCrossCheck: membershipsCount,
      pendingReportsCrossCheck: pendingReportsCount,
      bansCountCrossCheck: bansCount,
      profilesCountError: profCountErr?.message || null,
      totalUsersFromStats: totalUsers,
      note: 'total_users counts auth.users; profiles count matched in this project',
    }
    console.log(JSON.stringify({
      pass: results.test2.pass,
      adminIsAdmin: results.test2.adminIsAdmin,
      totalUsersFromStats: results.test2.totalUsersFromStats,
      profilesCountCrossCheck: results.test2.profilesCountCrossCheck,
      tablesCountCrossCheck: results.test2.tablesCountCrossCheck,
      membershipsCountCrossCheck: results.test2.membershipsCountCrossCheck,
      pendingReportsCrossCheck: results.test2.pendingReportsCrossCheck,
      bansCountCrossCheck: results.test2.bansCountCrossCheck,
      totals: statsMonth?.totals,
      newUsersSample: (statsMonth?.new_users || []).slice(-3),
      statsDayBuckets: results.test2.statsDayBuckets,
      statsYearBuckets: results.test2.statsYearBuckets,
    }, null, 2))
    console.log('\nFull admin_get_stats(month) JSON:')
    console.log(JSON.stringify(statsMonth, null, 2))
  } catch (e) {
    results.test2 = { pass: false, error: String(e) }
    console.log('FAIL:', e)
  }

  // ── TEST 3: report → ban flow ──
  console.log('\n=== TEST 3: report → ban flow ===')
  try {
    const { client: adminClient } = await login(ADMIN_EMAIL, ADMIN_PASSWORD)

    const reporter = await signup(`t3reporter${ts}@test.local`, 'Report', 'Sender')
    const reported = await signup(`t3reported${ts}@test.local`, 'Ban', 'Target')
    const repClient = await clientFor(reporter)
    const reportedClient = await clientFor(reported)
    const reportedId = reported.user.id

    await waitForProfile(repClient, reporter.user.id)
    await waitForProfile(reportedClient, reportedId)

    const { data: insertedReport, error: insErr } = await repClient
      .from('reports')
      .insert({
        reporter_id: reporter.user.id,
        reported_id: reportedId,
        reason: 'Test admin flow',
      })
      .select('id, status, reason')
      .single()
    if (insErr) throw insErr

    const { data: queueBefore, error: qErr } = await adminClient.rpc('admin_get_reports', { p_status: 'pending' })
    if (qErr) throw qErr
    const inQueue = (queueBefore || []).find((r) => r.id === insertedReport.id)

    const { data: banCount, error: banErr } = await adminClient.rpc('admin_ban_from_report', {
      p_report_id: insertedReport.id,
      p_reason: insertedReport.reason,
    })
    if (banErr) throw banErr

    const { data: queueAfter } = await adminClient.rpc('admin_get_reports', { p_status: 'pending' })
    const stillPending = (queueAfter || []).some((r) => r.id === insertedReport.id)

    const { data: bannedHistory } = await adminClient.rpc('admin_get_reports', { p_status: 'reviewed_banned' })
    const inBannedHistory = (bannedHistory || []).find((r) => r.id === insertedReport.id)

    const { data: banRows, error: banRowsErr } = await adminClient
      .from('bans')
      .select('id, user_id, reason, created_at')
      .eq('user_id', reportedId)
      .order('created_at', { ascending: false })

    const { data: notifs } = await reportedClient
      .from('notifications')
      .select('body, icon, created_at')
      .eq('user_id', reportedId)
      .order('created_at', { ascending: false })
      .limit(3)

    results.test3 = {
      pass:
        insertedReport.status === 'pending' &&
        !!inQueue &&
        typeof banCount === 'number' &&
        banCount >= 1 &&
        !stillPending &&
        inBannedHistory?.status === 'reviewed_banned' &&
        (banRows || []).length >= 1,
      reportId: insertedReport.id,
      reportedId,
      reportReason: insertedReport.reason,
      queueEntry: inQueue,
      banCountReturned: banCount,
      stillInPending: stillPending,
      bannedHistoryEntry: inBannedHistory,
      banRows: banRows || [],
      banRowsError: banRowsErr?.message || null,
      notifications: notifs || [],
    }
    console.log(JSON.stringify(results.test3, null, 2))
  } catch (e) {
    results.test3 = { pass: false, error: String(e) }
    console.log('FAIL:', e)
  }

  // ── TEST 4: dismiss flow ──
  console.log('\n=== TEST 4: dismiss flow (no ban) ===')
  try {
    const { client: adminClient } = await login(ADMIN_EMAIL, ADMIN_PASSWORD)

    const reporter = await signup(`t4reporter${ts}@test.local`, 'Dismiss', 'Sender')
    const reported = await signup(`t4reported${ts}@test.local`, 'Safe', 'Target')
    const repClient = await clientFor(reporter)
    const reportedId = reported.user.id

    await waitForProfile(repClient, reporter.user.id)
    await waitForProfile(await clientFor(reported), reportedId)

    const { count: bansBefore } = await adminClient
      .from('bans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', reportedId)

    const { data: insertedReport, error: insErr } = await repClient
      .from('reports')
      .insert({
        reporter_id: reporter.user.id,
        reported_id: reportedId,
        reason: 'Test dismiss flow',
      })
      .select('id, status')
      .single()
    if (insErr) throw insErr

    const { error: dismissErr } = await adminClient.rpc('admin_dismiss_report', {
      p_report_id: insertedReport.id,
    })
    if (dismissErr) throw dismissErr

    const { data: dismissedHistory } = await adminClient.rpc('admin_get_reports', {
      p_status: 'reviewed_dismissed',
    })
    const dismissedEntry = (dismissedHistory || []).find((r) => r.id === insertedReport.id)

    const { count: bansAfter } = await adminClient
      .from('bans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', reportedId)

    results.test4 = {
      pass:
        dismissedEntry?.status === 'reviewed_dismissed' &&
        (bansBefore || 0) === 0 &&
        (bansAfter || 0) === 0,
      reportId: insertedReport.id,
      reportedId,
      dismissedEntry,
      bansBefore: bansBefore || 0,
      bansAfter: bansAfter || 0,
    }
    console.log(JSON.stringify(results.test4, null, 2))
  } catch (e) {
    results.test4 = { pass: false, error: String(e) }
    console.log('FAIL:', e)
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
