/**
 * Post-migration verification for maps_link CHECK + wednesday backfill
 * node verification/verify-maps-migration-applied.mjs
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { wednesdayMapsUrl, isValidMapsLink } from '../src/lib/eventSchedule.js'
import { requireE2EEmail, requireE2EPassword } from '../scripts/_requireE2EEnv.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ts = Date.now()
const OUT = path.join(__dirname, 'evidence', 'maps-location', `migration-applied-${ts}`)
fs.mkdirSync(OUT, { recursive: true })

const SUPABASE_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'
const ADMIN_EMAIL = requireE2EEmail()
const ADMIN_PASSWORD = requireE2EPassword()

const EXPECTED_CHECK =
  "CHECK (((maps_link IS NULL) OR (maps_link ~* '^https?://(www\\.)?(google\\.[a-z.]+/maps|maps\\.google\\.[a-z.]+|maps\\.app\\.goo\\.gl|goo\\.gl/maps)')))"

const report = { ts, project: 'upxxfhvgbmddhyebaiug', outDir: OUT, steps: {} }

function save(name, data) {
  fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2))
}

async function authAdmin() {
  const client = createClient(SUPABASE_URL, ANON_KEY)
  const { data, error } = await client.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  })
  if (error) throw error
  return { client, userId: data.user.id }
}

function futureIso(hoursFromNow) {
  const d = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000)
  d.setMinutes(0, 0, 0)
  return d.toISOString()
}

async function main() {
  const { client, userId } = await authAdmin()

  // STEP 1 — query pg_constraint via PostgREST if exposed, else RPC workaround
  // Direct table read on pg_constraint isn't exposed; try service-less SQL via supabase meta API
  const step1Sql = `
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.tables'::regclass
      AND conname LIKE '%maps_link%';
  `

  // Attempt via supabase management / sql endpoint (requires service role)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || ''
  if (serviceKey) {
    const admin = createClient(SUPABASE_URL, serviceKey)
    const { data, error } = await admin.rpc('exec_sql', { query: step1Sql }).catch(() => ({ data: null, error: { message: 'no exec_sql rpc' } }))
    if (!error && data) {
      report.steps.step1 = { method: 'service_role exec_sql', rows: data }
    }
  }

  if (!report.steps.step1) {
    // Probe constraint indirectly: old pattern https://example.com must fail; null must pass
    const tomorrow = futureIso(48)
    const baseRow = {
      host_id: userId,
      kind: 'tavoline',
      category: 'kafe',
      title: `Constraint probe ${ts}`,
      area: 'Qendra',
      city: 'Prishtinë',
      time_label: 'Test',
      event_datetime: tomorrow,
      starts_at: tomorrow,
      spots: 4,
      langs: ['sq'],
      tags: [],
      description: 'constraint probe',
    }

    const { error: invalidErr } = await client.from('tables').insert({
      ...baseRow,
      title: `Invalid maps ${ts}`,
      maps_link: 'https://example.com',
    })

    const { error: nullErr } = await client.from('tables').insert({
      ...baseRow,
      title: `Null maps legacy ${ts}`,
      maps_link: null,
    })

    const { data: validRow, error: validErr } = await client
      .from('tables')
      .insert({
        ...baseRow,
        title: `Valid maps ${ts}`,
        maps_link: 'https://www.google.com/maps/place/Test/@42.66,21.16,17z',
      })
      .select('id')
      .single()

    if (validRow?.id) {
      await client.from('tables').delete().eq('id', validRow.id)
    }
    if (nullErr?.code === '23514') {
      // cleanup partial if needed
    } else {
      const { data: nullInserted } = await client
        .from('tables')
        .select('id')
        .eq('title', `Null maps legacy ${ts}`)
        .maybeSingle()
      if (nullInserted?.id) await client.from('tables').delete().eq('id', nullInserted.id)
    }

    report.steps.step1 = {
      method: 'behavioral_probe_no_service_role_sql',
      note: 'pg_get_constraintdef requires SQL editor or service role; inferred from insert behavior',
      invalidInsert: {
        code: invalidErr?.code ?? null,
        message: invalidErr?.message ?? null,
        details: invalidErr?.details ?? null,
        hint: invalidErr?.hint ?? null,
        rejected: invalidErr?.code === '23514',
        constraintNameMentioned: /tables_maps_link_check/i.test(invalidErr?.message || ''),
      },
      nullInsertAllowed: !nullErr || nullErr.code !== '23514',
      validGoogleInsertOk: !validErr,
      expectedDefinition: EXPECTED_CHECK,
      matchesStricterPattern:
        invalidErr?.code === '23514' && !validErr && (nullErr == null || nullErr.code !== '23514'),
    }
  }

  // STEP 2 — wednesday_restaurants backfill
  let restaurants = null
  let step2Error = null
  if (serviceKey) {
    const admin = createClient(SUPABASE_URL, serviceKey)
    const { data, error } = await admin
      .from('wednesday_restaurants')
      .select('id, name, address, city, maps_link')
      .order('name')
    restaurants = data
    step2Error = error
  } else {
    // RLS blocks direct select — sample via repeated RPC reveals
    const seen = new Map()
    for (let i = 0; i < 40; i++) {
      const { data: groupId, error: gErr } = await client.rpc('create_wednesday_dinner_group', {
        p_city: 'Prishtinë',
        p_dinner_date: futureIso(10 + i * 0.01),
      })
      if (gErr) continue
      await client.from('wednesday_participants').upsert({ group_id: groupId, user_id: userId })
      const { data: rev } = await client.rpc('get_wednesday_restaurant', { p_group: groupId })
      if (rev?.revealed && rev?.name) {
        seen.set(rev.name, {
          name: rev.name,
          address: rev.address,
          maps_link: rev.maps_link,
        })
      }
    }
    restaurants = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  const nullCount = (restaurants || []).filter((r) => !r.maps_link).length
  const searchFormatCount = (restaurants || []).filter((r) =>
    /google\.[a-z.]+\/maps\/search\/\?api=1&query=/i.test(r.maps_link || ''),
  ).length

  report.steps.step2 = {
    method: serviceKey ? 'direct_select_service_role' : 'rpc_sampling_prishtine_groups',
    rowCount: restaurants?.length ?? 0,
    nullMapsLinkCount: nullCount,
    searchUrlFormatCount: searchFormatCount,
    allRowsPopulated: nullCount === 0 && (restaurants?.length ?? 0) > 0,
    rows: restaurants,
    error: step2Error?.message ?? null,
  }

  // STEP 3 — explicit invalid insert (DB rejection)
  const probeIso = futureIso(72)
  const { error: step3Err } = await client.from('tables').insert({
    host_id: userId,
    kind: 'tavoline',
    category: 'kafe',
    title: `Step3 invalid ${ts}`,
    area: 'Qendra',
    city: 'Prishtinë',
    time_label: 'Test',
    event_datetime: probeIso,
    starts_at: probeIso,
    spots: 4,
    langs: ['sq'],
    tags: [],
    description: 'step3 db constraint test',
    maps_link: 'https://example.com',
  })

  report.steps.step3 = {
    insertAttempt: { maps_link: 'https://example.com' },
    postgresError: {
      code: step3Err?.code ?? null,
      message: step3Err?.message ?? null,
      details: step3Err?.details ?? null,
      hint: step3Err?.hint ?? null,
    },
    rejectedByDb: step3Err?.code === '23514',
    pass: step3Err?.code === '23514' && /tables_maps_link_check/i.test(step3Err?.message || ''),
  }

  // STEP 4 — Wednesday reveal uses DB maps_link (not client-only fallback)
  const { data: groupNear, error: gNearErr } = await client.rpc('create_wednesday_dinner_group', {
    p_city: 'Prishtinë',
    p_dinner_date: futureIso(12),
  })
  if (gNearErr) throw gNearErr
  await client.from('wednesday_participants').upsert({ group_id: groupNear, user_id: userId })
  const { data: revealedRest, error: revErr } = await client.rpc('get_wednesday_restaurant', {
    p_group: groupNear,
  })
  if (revErr) throw revErr

  const hrefFromDbLink = revealedRest?.maps_link
  const hrefFromHelper = wednesdayMapsUrl(revealedRest)
  const usesDbStoredLink =
    isValidMapsLink(hrefFromDbLink) && hrefFromHelper === hrefFromDbLink

  report.steps.step4 = {
    groupId: groupNear,
    revealedRestaurant: revealedRest,
    maps_linkFromRpc: hrefFromDbLink,
    wednesdayMapsUrlResult: hrefFromHelper,
    usesBackfilledDbLinkNotClientFallback: usesDbStoredLink,
    dbLinkIsSearchFormat: /google\.[a-z.]+\/maps\/search\/\?api=1&query=/i.test(hrefFromDbLink || ''),
    notPlaceholder: !/Restoranti sekret/i.test(hrefFromHelper),
    pass:
      revealedRest?.revealed === true &&
      isValidMapsLink(hrefFromDbLink) &&
      usesDbStoredLink &&
      !/Restoranti sekret/i.test(hrefFromHelper),
  }

  report.allPass = Object.values(report.steps).every((s) => s.pass !== false && (s.matchesStricterPattern !== false))
  report.allPass =
    (report.steps.step1.matchesStricterPattern !== false || report.steps.step1.rows) &&
    report.steps.step2.allRowsPopulated &&
    report.steps.step3.pass &&
    report.steps.step4.pass

  save('report.json', report)
  console.log(JSON.stringify(report, null, 2))
  if (!report.allPass) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
