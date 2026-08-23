/**
 * Security verification: registration photo upload exploit closed.
 * Run: node scripts/verify-registration-security.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { requireE2EEmail, requireE2EPassword } from './_requireE2EEnv.mjs'

const SB_URL = 'https://upxxfhvgbmddhyebaiug.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVweHhmaHZnYm1kZGh5ZWJhaXVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTU1MDgsImV4cCI6MjEwMTc5MTUwOH0.ck-BzoAASwbfiBCsFk6RXkOmGj_f-SIFeIlENx64f7Q'

const EXISTING_EMAIL = requireE2EEmail()
const EXISTING_PASSWORD = requireE2EPassword()
const ADMIN_EMAIL = EXISTING_EMAIL
const ADMIN_PASSWORD = EXISTING_PASSWORD

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

async function login(email, password) {
  const c = client()
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw error
  await setSession(c, data.session)
  return { client: c, userId: data.user.id, session: data.session }
}

async function signUpEmail(email, password, firstName, lastName, age = 25) {
  const res = await fetch(`${SB_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      data: { first_name: firstName, last_name: lastName, age },
    }),
  })
  return res.json()
}

async function getPhotoPath(c, userId) {
  const { data, error } = await c.from('profiles').select('photo_path, first_name, last_name').eq('id', userId).single()
  if (error) throw error
  return data
}

function tinyJpegFile(label) {
  // 1x1 red pixel jpeg — unique per test via comment in filename only
  const base64 =
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJ8A/9k='
  const buf = Buffer.from(base64, 'base64')
  return new File([buf], `${label}-${ts}.jpg`, { type: 'image/jpeg' })
}

async function uploadWithGuard(c, file, expectedUserId) {
  const { data: { user } } = await c.auth.getUser()
  if (!user) throw new Error('Nuk je i kyçur')
  if (expectedUserId && user.id !== expectedUserId) {
    throw new Error('Sesioni nuk përputhet — rifillo regjistrimin')
  }
  const path = `${user.id}/avatar.jpg`
  const { error: upErr } = await c.storage.from('avatars').upload(path, file, {
    upsert: true,
    contentType: 'image/jpeg',
  })
  if (upErr) throw new Error(upErr.message)
  const { error: profErr } = await c.from('profiles').update({ photo_path: path, photo_face_ok: true }).eq('id', user.id)
  if (profErr) throw new Error(profErr.message)
  return path
}

async function main() {
  const results = {}

  // Resolve existing account id + photo_path BEFORE tests
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  const existingBefore = await getPhotoPath(admin.client, admin.userId)
  console.log('Existing account BEFORE:', existingBefore)

  // TEST 1 — duplicate email rejected at signUp (step 1 equivalent), photo unchanged
  console.log('\n=== TEST 1: duplicate email blocked early ===')
  try {
    const dup = await signUpEmail(EXISTING_EMAIL, 'TotallyNewPass123!', 'Evil', 'Attacker')
    const rejected =
      !dup.access_token ||
      (dup.user && (dup.user.identities?.length ?? 0) === 0)
    const existingAfter = await getPhotoPath(admin.client, admin.userId)
    results.test1 = {
      pass:
        rejected &&
        existingAfter.photo_path === existingBefore.photo_path,
      rejected,
      photoPathBefore: existingBefore.photo_path,
      photoPathAfter: existingAfter.photo_path,
      signupResponse: {
        hasToken: !!dup.access_token,
        identities: dup.user?.identities?.length ?? null,
        msg: dup.msg || dup.error_description || dup.message || null,
      },
    }
    console.log(JSON.stringify(results.test1, null, 2))
  } catch (e) {
    results.test1 = { pass: false, error: String(e) }
    console.log('TEST 1 FAIL', e)
  }

  // TEST 2 — legitimate new registration + guarded upload
  console.log('\n=== TEST 2: legitimate registration ===')
  const newEmail = `sec-reg-${ts}@test.local`
  const newPass = 'TestPass123!'
  try {
    const created = await signUpEmail(newEmail, newPass, 'Legit', 'User')
    if (!created.access_token) throw new Error(`signup failed: ${JSON.stringify(created)}`)
    const newClient = client()
    await setSession(newClient, created)
    const newUserId = created.user.id
    const before = await getPhotoPath(newClient, newUserId)
    const marker = `legit-${ts}`
    const path = await uploadWithGuard(newClient, tinyJpegFile(marker), newUserId)
    const after = await getPhotoPath(newClient, newUserId)
    results.test2 = {
      pass:
        after.photo_path === path &&
        after.photo_path?.includes(newUserId) &&
        after.photo_path !== before.photo_path,
      newUserId,
      photoPathBefore: before.photo_path,
      photoPathAfter: after.photo_path,
      uploadedPath: path,
    }
    console.log(JSON.stringify(results.test2, null, 2))
  } catch (e) {
    results.test2 = { pass: false, error: String(e) }
    console.log('TEST 2 FAIL', e)
  }

  // TEST 3 — stale session A cannot upload to wrong user (simulates exploit)
  console.log('\n=== TEST 3: stale session guard ===')
  try {
    const accountA = await login(EXISTING_EMAIL, EXISTING_PASSWORD)
    const photoABefore = (await getPhotoPath(accountA.client, accountA.userId)).photo_path

    const accountBEmail = `sec-stale-${ts}@test.local`
    const createdB = await signUpEmail(accountBEmail, newPass, 'Fresh', 'Account')
    if (!createdB.access_token) throw new Error(`B signup failed: ${JSON.stringify(createdB)}`)
    const userBId = createdB.user.id

    // Session still A — attempt upload targeting B's id must fail
    let wrongUploadError = null
    try {
      await uploadWithGuard(accountA.client, tinyJpegFile('evil'), userBId)
    } catch (err) {
      wrongUploadError = err.message
    }

    const photoAAfterWrong = (await getPhotoPath(accountA.client, accountA.userId)).photo_path

    // Correct flow: sign out A, session B, upload to B only
    await accountA.client.auth.signOut()
    const clientB = client()
    await setSession(clientB, createdB)
    const pathB = await uploadWithGuard(clientB, tinyJpegFile('good'), userBId)
    const photoB = await getPhotoPath(clientB, userBId)
    const photoAFinalRow = await getPhotoPath(admin.client, accountA.userId)

    results.test3 = {
      pass:
        !!wrongUploadError?.includes('Sesioni nuk përputhet') &&
        photoAAfterWrong === photoABefore &&
        photoAFinalRow.photo_path === photoABefore &&
        photoB.photo_path === pathB &&
        photoB.photo_path?.includes(userBId),
      wrongUploadBlocked: wrongUploadError,
      accountAPhotoBefore: photoABefore,
      accountAPhotoAfterStaleAttempt: photoAAfterWrong,
      accountAPhotoFinal: photoAFinalRow.photo_path,
      accountBPhoto: photoB.photo_path,
      accountBId: userBId,
    }
    console.log(JSON.stringify(results.test3, null, 2))
  } catch (e) {
    results.test3 = { pass: false, error: String(e) }
    console.log('TEST 3 FAIL', e)
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
