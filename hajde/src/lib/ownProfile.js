import { sb } from '../supabaseClient'

/**
 * The signed-in user's full profile row, shared by everyone who needs it at
 * startup (useProfile, post-login routing, onboarding resume, notification
 * prefs). Concurrent/near-simultaneous callers get the same request instead of
 * four separate ones. `fresh: true` (after a write) always hits the database.
 */
const TTL = 4000
let entry = null // { uid, at, promise }

export function fetchOwnProfile(uid, { fresh = false } = {}) {
  if (!uid) return Promise.resolve({ data: null, error: null })
  if (!fresh && entry && entry.uid === uid && Date.now() - entry.at < TTL) return entry.promise
  const promise = sb.from('profiles').select('*').eq('id', uid).maybeSingle()
    .then((res) => { if (res.error && entry?.promise === promise) entry = null; return res })
  entry = { uid, at: Date.now(), promise }
  return promise
}

export function invalidateOwnProfile() { entry = null }
