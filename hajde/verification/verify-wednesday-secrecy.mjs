/**
 * Wednesday Dinner secrecy bypass investigation + post-fix verification
 * node verification/verify-wednesday-secrecy.mjs [--post-fix]
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { wednesdayMapsUrl, isValidMapsLink } from '../src/lib/eventSchedule.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ts = Date.now()
const postFix = process.argv.includes('--post-fix')
const OUT = path.join(__dirname, 'evidence', 'wednesday-secrecy', `${postFix ? 'post-fix' : 'pre-fix'}-${ts}`)
fs.mkdirSync(OUT, { recursive: true })

const SUPABASE_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const ADMIN_EMAIL = 'ejabashkohu@gmail.com'
const ADMIN_PASSWORD = 'ejaBashkohu1@@'
const MEMBER_PASSWORD = 'TestPass123!'

const report = { ts, postFix, outDir: OUT, steps: {}, tests: {} }

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2))
}

async function authAs(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return { client, userId: data.user.id, email: data.user.email }
}

function futureIso(hours) {
  const d = new Date(Date.now() + hours * 3600000)
  d.setMinutes(0, 0, 0)
  return d.toISOString()
}

async function guerrillaInbox() {
  const init = await fetch('https://api.guerrillamail.com/ajax.php?f=get_email_address').then((r) => r.json())
  return { address: init.email_addr, sid: init.sid_token }
}

async function waitConfirmLink(sid) {
  for (let i = 0; i < 40; i += 1) {
    const list = await fetch(
      `https://api.guerrillamail.com/ajax.php?f=get_email_list&offset=0&sid_token=${encodeURIComponent(sid)}`,
    ).then((r) => r.json())
    for (const m of list.list || []) {
      const full = await fetch(
        `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(m.mail_id)}&sid_token=${encodeURIComponent(sid)}`,
      ).then((r) => r.json())
      const html = full.mail_body || full.mail_body_html || ''
      const match = html.match(/https:[^\"]+auth\/v1\/verify[^\"]*/i)
      if (match) return match[0].replace(/&amp;/g, '&')
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('confirm email timeout')
}

async function createConfirmedMember() {
  const inbox = await guerrillaInbox()
  const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: inbox.address,
      password: MEMBER_PASSWORD,
      data: { first_name: 'WedSec', last_name: 'Member', age: 28 },
    }),
  })
  if (!signupRes.ok) throw new Error(`member signup failed: ${await signupRes.text()}`)
  const confirmLink = await waitConfirmLink(inbox.sid)
  const verifyRes = await fetch(confirmLink, { redirect: 'follow' })
  report.steps.memberSignup = {
    email: inbox.address,
    confirmLinkHit: verifyRes.status,
  }
  return authAs(inbox.address, MEMBER_PASSWORD)
}

async function directBypassProbe(client, groupId) {
  const groupDirect = await client.from('wednesday_groups').select('*').eq('id', groupId).maybeSingle()
  const restaurantsAll = await client.from('wednesday_restaurants').select('*')
  const joinLeak = await client
    .from('wednesday_groups')
    .select('id, city, dinner_date, restaurant_id, wednesday_restaurants(name, address, maps_link)')
    .eq('id', groupId)
    .maybeSingle()

  let restaurantById = null
  if (groupDirect.data?.restaurant_id) {
    restaurantById = await client
      .from('wednesday_restaurants')
      .select('*')
      .eq('id', groupDirect.data.restaurant_id)
      .maybeSingle()
  }

  return {
    groupDirect: { data: groupDirect.data, error: groupDirect.error, count: groupDirect.data ? 1 : 0 },
    restaurantsAll: {
      data: restaurantsAll.data,
      error: restaurantsAll.error,
      count: restaurantsAll.data?.length ?? 0,
    },
    joinLeak: { data: joinLeak.data, error: joinLeak.error },
    restaurantById: { data: restaurantById?.data, error: restaurantById?.error },
    restaurantIdLeaked: groupDirect.data?.restaurant_id ?? null,
  }
}

async function main() {
  const admin = await authAs(ADMIN_EMAIL, ADMIN_PASSWORD)
  const member = await createConfirmedMember()
  report.steps.memberAccount = { email: member.email, userId: member.userId }

  // Member creates own groups (only path that adds wednesday_participants under RLS)
  const { data: groupFar, error: gFarErr } = await member.client.rpc('create_wednesday_dinner_group', {
    p_city: 'Prishtinë',
    p_dinner_date: futureIso(72),
  })
  if (gFarErr) throw gFarErr

  const { data: groupNear, error: gNearErr } = await member.client.rpc('create_wednesday_dinner_group', {
    p_city: 'Prishtinë',
    p_dinner_date: futureIso(12),
  })
  if (gNearErr) throw gNearErr

  report.steps.groups = { groupFar, groupNear, memberEmail: member.email }

  // RPC baseline — member session (real app user)
  const { data: rpcLocked, error: rpcLockedErr } = await member.client.rpc('get_wednesday_restaurant', {
    p_group: groupFar,
  })
  report.steps.step2_rpc_pre = { data: rpcLocked, error: rpcLockedErr }

  const memberDirectPre = await directBypassProbe(member.client, groupFar)
  const adminDirectPre = await directBypassProbe(admin.client, groupFar)
  report.steps.step2_member_direct_pre = memberDirectPre
  report.steps.step2_admin_direct_pre = {
    groupDirect: adminDirectPre.groupDirect,
    restaurantsAll: {
      count: adminDirectPre.restaurantsAll.count,
      error: adminDirectPre.restaurantsAll.error?.message ?? null,
    },
    joinLeak: adminDirectPre.joinLeak,
    restaurantIdLeaked: adminDirectPre.restaurantIdLeaked,
    note: 'Admin intentionally retains wg_select_admin / wr_select_admin access after fix',
  }

  // TEST 1 — RPC regression both states (member)
  const { data: rpcRevealed, error: rpcRevealedErr } = await member.client.rpc('get_wednesday_restaurant', {
    p_group: groupNear,
  })
  report.tests.test1 = {
    preReveal: rpcLocked,
    preRevealError: rpcLockedErr?.message ?? null,
    postReveal: rpcRevealed,
    postRevealError: rpcRevealedErr?.message ?? null,
    pass:
      rpcLocked?.revealed === false &&
      !rpcLocked?.name &&
      !rpcLocked?.maps_link &&
      rpcRevealed?.revealed === true &&
      !!rpcRevealed?.name &&
      isValidMapsLink(rpcRevealed?.maps_link),
  }

  // TEST 2 — member direct bypass blocked after fix; pre-fix documents leak
  const m = memberDirectPre
  report.tests.test2 = {
    actor: 'non-admin member',
    memberEmail: member.email,
    query_groupDirect: m.groupDirect,
    query_restaurantsAll: {
      count: m.restaurantsAll.count,
      error: m.restaurantsAll.error?.message ?? null,
      data: m.restaurantsAll.data,
    },
    query_joinLeak: m.joinLeak,
    query_restaurantById: m.restaurantById,
    restaurantsDirectCount: m.restaurantsAll.count,
    groupShowsRestaurantId: !!m.groupDirect.data?.restaurant_id,
    restaurantNameViaDirectLookup: m.restaurantById?.data?.name ?? null,
    joinShowsRestaurantName: m.joinLeak.data?.wednesday_restaurants?.name ?? null,
    pass: postFix
      ? m.restaurantsAll.count === 0 &&
        !m.groupDirect.data?.restaurant_id &&
        !m.joinLeak.data?.restaurant_id &&
        !m.joinLeak.data?.wednesday_restaurants?.name
      : !!m.groupDirect.data?.restaurant_id && !m.joinLeak.data?.wednesday_restaurants?.name,
    note: postFix
      ? 'Post-fix: member direct paths must not expose restaurant identity pre-reveal'
      : 'Pre-fix: member could read restaurant_id via wednesday_groups; names blocked by wednesday_restaurants RLS',
  }

  // TEST 3 — post-reveal maps still work (member)
  const mapsHref = wednesdayMapsUrl(rpcRevealed)
  report.tests.test3 = {
    rpcRevealed,
    mapsHref,
    pass:
      rpcRevealed?.revealed === true &&
      isValidMapsLink(rpcRevealed?.maps_link) &&
      mapsHref === rpcRevealed.maps_link,
  }

  // TEST 4 — admin can read restaurant pool
  const adminRestaurants = await admin.client.from('wednesday_restaurants').select('id, name')
  report.tests.test4 = {
    actor: 'admin',
    adminCanReadPool: (adminRestaurants.data?.length ?? 0) > 0,
    poolCount: adminRestaurants.data?.length ?? 0,
    error: adminRestaurants.error?.message ?? null,
    sample: adminRestaurants.data?.slice(0, 5) ?? [],
    pass: postFix ? (adminRestaurants.data?.length ?? 0) >= 20 : true,
  }

  const memberGroupsRpc = await member.client.rpc('get_my_wednesday_groups')
  report.tests.memberGroupsRpc = {
    data: memberGroupsRpc.data,
    error: memberGroupsRpc.error?.message ?? null,
    hasSafeFieldsOnly:
      Array.isArray(memberGroupsRpc.data) &&
      memberGroupsRpc.data.some((r) => r.group_id === groupFar) &&
      memberGroupsRpc.data.every((r) => r.group_id && r.dinner_date && r.city && !('restaurant_id' in r)),
    pass:
      !memberGroupsRpc.error &&
      Array.isArray(memberGroupsRpc.data) &&
      memberGroupsRpc.data.every((r) => r.group_id && r.dinner_date && r.city && !('restaurant_id' in r)),
  }

  report.allPass = ['test1', 'test2', 'test3', 'test4', 'memberGroupsRpc'].every((k) => report.tests[k].pass === true)
  save('report.json', report)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
