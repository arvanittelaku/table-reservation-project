import { sb, API_BASE_URL, type AuthEvent, type AuthUser, type Session } from '../backendClient'
import { codedError } from '../lib/errors'

export interface AuthProviders { google: boolean; apple: boolean }
export type SocialProvider = 'google' | 'apple'

let providersPromise: Promise<AuthProviders> | null = null
/** Which social sign-ins the backend has configured ({ google, apple }); cached per page load. */
export function fetchAuthProviders(): Promise<AuthProviders> {
  if (!providersPromise) {
    providersPromise = fetch(`${API_BASE_URL}/auth/v1/settings`)
      .then((r) => (r.ok ? (r.json() as Promise<{ external?: Record<string, boolean> }>) : null))
      .then((d) => ({ google: !!d?.external?.google, apple: !!d?.external?.apple }))
      .catch(() => { providersPromise = null; return { google: true, apple: false } })
  }
  return providersPromise
}

const MIN_AGE = 18

function throwAuthError(error: unknown): never {
  throw codedError(error)
}

function isEmailConfirmed(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  return !!(user.email_confirmed_at || user.confirmed_at)
}

/**
 * Register a new user. Metadata is passed so the DB trigger can create the profile.
 * Password is only sent to Supabase Auth — never stored or logged by this app.
 */
export interface SignUpResult { user: AuthUser | null; session: Session | null; needsEmailConfirmation: boolean }

export async function signUp(email: string, password: string, firstName: string, lastName: string, age: string | number): Promise<SignUpResult> {
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
export async function resendSignupConfirmation(email: string) {
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
export async function signIn(email: string, password: string): Promise<Session | null> {
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
export async function signInWithProvider(provider: SocialProvider) {
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
export async function getSessionUser(): Promise<AuthUser | null> {
  const { data } = await sb.auth.getSession()
  return data?.session?.user ?? null
}

/**
 * Ask the Auth server whether the saved session is still valid.
 * 'invalid' only when the server rejects it (deleted/banned user, revoked
 * session); network problems give 'unknown' so offline users stay signed in.
 */
export async function verifySession(): Promise<'ok' | 'invalid' | 'unknown'> {
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
export async function getUser(): Promise<AuthUser | null> {
  const { data, error } = await sb.auth.getUser()
  if (error) return null
  return data.user ?? null
}

/**
 * Subscribe to login / logout. Callback receives (event, session).
 * Returns the unsubscribe function.
 */
export function onAuthStateChange(callback: (event: AuthEvent, session: Session | null) => void): () => void {
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    callback(event, session)
  })
  return () => data.subscription.unsubscribe()
}
