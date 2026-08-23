/**
 * Email registration validation — duplicate block + MX domain check.
 * Run: node scripts/verify-email-registration.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { isEmailFormatValid } from '../src/lib/emailValidation.js'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const EXISTING_EMAIL = process.env.EXISTING_EMAIL || 'ejabashkohu@gmail.com'
const EXISTING_PASSWORD = process.env.EXISTING_PASSWORD || 'ejaBashkohu1@@'
const DOH_URL = 'https://cloudflare-dns.com/dns-query'

const ts = Date.now()
let failed = 0

function pass(label, ok, detail = '') {
  if (ok) console.log(`PASS  ${label}${detail ? `: ${detail}` : ''}`)
  else {
    failed++
    console.error(`FAIL  ${label}${detail ? `: ${detail}` : ''}`)
  }
}

async function signUpEmail(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      data: { first_name: 'Email', last_name: 'Test', age: 25 },
    }),
  })
  return res.json()
}

async function checkMx(domain) {
  const res = await fetch(`${DOH_URL}?name=${encodeURIComponent(domain)}&type=MX`, {
    headers: { Accept: 'application/dns-json' },
  })
  const data = await res.json()
  return Array.isArray(data.Answer) && data.Answer.length > 0
}

async function invokeEdge(email) {
  const t0 = performance.now()
  const res = await fetch(`${SB_URL}/functions/v1/check-email-domain`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  })
  const elapsedMs = Math.round(performance.now() - t0)
  const headers = {
    servedBy: res.headers.get('x-served-by'),
    edgeRegion: res.headers.get('x-sb-edge-region'),
    denoExecutionId: res.headers.get('x-deno-execution-id'),
    projectRef: res.headers.get('sb-project-ref'),
    cfRay: res.headers.get('cf-ray'),
  }
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text), headers, elapsedMs } }
  catch { return { status: res.status, body: { raw: text }, headers, elapsedMs } }
}

async function main() {
  pass('format rejects garbage', !isEmailFormatValid('not-an-email'))
  pass('format accepts user@domain.com', isEmailFormatValid('user@domain.com'))

  console.log('\n=== TEST 1 duplicate email ===')
  const dup = await signUpEmail(EXISTING_EMAIL, 'TotallyNewPass123!')
  const rejected =
    !dup.access_token ||
    (dup.user && (dup.user.identities?.length ?? 0) === 0)
  pass(
    'duplicate blocked at signUp → "Ky email është i regjistruar tashmë" in UI',
    rejected,
    `msg=${dup.msg || dup.error_description || dup.message || 'none'}`,
  )

  const sb = createClient(SB_URL, ANON)
  const { error: loginErr } = await sb.auth.signInWithPassword({
    email: EXISTING_EMAIL,
    password: EXISTING_PASSWORD,
  })
  pass('existing account still loginable', !loginErr)

  console.log('\n=== TEST 2 fake domain (no MX) ===')
  const fakeDomain = `${ts}.thisdomaindoesnotexist12345.com`
  const fakeEmail = `test@${fakeDomain}`
  const fakeMx = await checkMx(fakeDomain)
  pass('fake domain has no MX (DoH reference)', !fakeMx, fakeDomain)

  const edgeFake = await invokeEdge(fakeEmail)
  const edgePath =
    edgeFake.status === 200 &&
    edgeFake.headers.servedBy === 'supabase-edge-runtime' &&
    !!edgeFake.headers.denoExecutionId

  console.log('TEST 2 path evidence:', JSON.stringify({
    path: edgePath ? 'edge_function' : edgeFake.status === 404 ? 'doh_fallback_only' : 'unknown',
    httpStatus: edgeFake.status,
    elapsedMs: edgeFake.elapsedMs,
    headers: edgeFake.headers,
    body: edgeFake.body,
  }, null, 2))

  pass('edge function deployed and reachable', edgeFake.status === 200, `status=${edgeFake.status}`)
  pass('TEST 2 uses Edge Function (not DoH fallback)', edgePath, `x-served-by=${edgeFake.headers.servedBy}`)
  pass('edge rejects fake domain', edgeFake.body?.valid === false, JSON.stringify(edgeFake.body))
  pass('edge response includes reason=no_mx', edgeFake.body?.reason === 'no_mx')

  console.log('\n=== TEST 3 testtest@gmail.com (documented limitation) ===')
  const gmailMx = await checkMx('gmail.com')
  pass('gmail.com has MX records', gmailMx)
  const gmailSignup = await signUpEmail(`testtest+${ts}@gmail.com`, 'TestPass123!')
  const gmailProceeds =
    !!gmailSignup.access_token ||
    (gmailSignup.user?.identities?.length ?? 0) > 0 ||
    gmailSignup.msg === 'User already registered'
  pass(
    'testtest@gmail.com passes domain check and reaches signUp (EXPECTED — cannot verify mailbox without sending mail)',
    gmailProceeds,
    `hasToken=${!!gmailSignup.access_token}`,
  )

  console.log('\n=== TEST 4 legitimate domain ===')
  const outlookMx = await checkMx('outlook.com')
  pass('outlook.com has MX', outlookMx)
  const legitSignup = await signUpEmail(`email-reg-${ts}@outlook.com`, 'TestPass123!')
  pass(
    'legitimate outlook.com signup succeeds',
    !!legitSignup.access_token || !!legitSignup.user?.id,
    legitSignup.msg || 'ok',
  )

  console.log(failed ? `\n${failed} test(s) FAILED` : '\nAll tests PASS')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
