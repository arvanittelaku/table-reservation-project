import { sb } from '../supabaseClient'

const MIN_AGE = 18

function throwAuthError(error) {
  const e = new Error(error?.message || String(error))
  if (error?.code) e.code = error.code
  if (error?.error_code) e.error_code = error.error_code
  if (error?.weak_password) e.weak_password = error.weak_password
  throw e
}

function isEmailConfirmed(user) {
  if (!user) return false
  return !!(user.email_confirmed_at || user.confirmed_at)
}

/**
 * Register a new user. Metadata is passed so the DB trigger can create the profile.
 * Password is only sent to Supabase Auth — never stored or logged by this app.
 */
export async function signUp(email, password, firstName, lastName, age) {
  const parsedAge = Number(age)

  if (!Number.isFinite(parsedAge) || parsedAge < MIN_AGE) {
    throw new Error('You must be 18 or older to join ejaBashkohu')
  }

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin,
      data: {
        first_name: firstName,
        last_name: lastName,
        age: parsedAge,
      },
    },
  })

  if (error) throwAuthError(error)

  // Supabase email-enumeration protection: existing users often come back as
  // a user object with an empty identities array and no session. Treat that
  // as "already registered" instead of sending them to the confirm-email UI.
  if (!data.session && data.user && (data.user.identities?.length ?? 0) === 0) {
    throw new Error('User already registered')
  }

  // Email confirmation enabled → user exists but is not confirmed yet
  const needsEmailConfirmation = !!data.user && !isEmailConfirmed(data.user)

  return {
    user: data.user,
    session: data.session,
    needsEmailConfirmation,
  }
}

/** Resend the signup confirmation email. */
export async function resendSignupConfirmation(email) {
  const { error } = await sb.auth.resend({
    type: 'signup',
    email,
    options: {
      emailRedirectTo: window.location.origin,
    },
  })
  if (error) throwAuthError(error)
}

/** Sign in and return the session. */
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({
    email,
    password,
  })
  if (error) throwAuthError(error)
  return data.session
}

/**
 * Google / Apple sign-in. Redirects away; on return the session is picked up from
 * the URL and the app sends incomplete profiles through onboarding (name, age,
 * photo, terms). Providers must be enabled in Supabase → Authentication → Providers.
 */
export async function signInWithProvider(provider) {
  if (!['google', 'apple'].includes(provider)) throw new Error('Unsupported provider')
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.origin },
  })
  if (error) throwAuthError(error)
}

export async function signOut() {
  const { error } = await sb.auth.signOut()
  if (error) throwAuthError(error)
}

/** User from the session saved on this device (no network). */
export async function getSessionUser() {
  const { data } = await sb.auth.getSession()
  return data?.session?.user ?? null
}

/**
 * Ask the Auth server whether the saved session is still valid.
 * 'invalid' only when the server rejects it (deleted/banned user, revoked
 * session); network problems give 'unknown' so offline users stay signed in.
 */
export async function verifySession() {
  try {
    const { data, error } = await sb.auth.getUser()
    if (!error && data?.user) return 'ok'
    const status = error?.status
    if (status === 401 || status === 403 || /user.*(not|does not) exist|invalid jwt|session.*not found/i.test(error?.message || '')) return 'invalid'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Current auth user, or null. Asks the Auth server (one network request). */
export async function getUser() {
  const { data, error } = await sb.auth.getUser()
  if (error) return null
  return data.user ?? null
}

/**
 * Subscribe to login / logout. Callback receives (event, session).
 * Returns the unsubscribe function.
 */
export function onAuthStateChange(callback) {
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    callback(event, session)
  })
  return () => data.subscription.unsubscribe()
}
