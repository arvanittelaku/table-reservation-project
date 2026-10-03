const KEY = 'ejabashkohu-pending-registration'

/** @typedef {{ userId: string, email: string, firstName: string, lastName: string, age: string, savedAt?: number }} PendingRegistration */

/** @param {Omit<PendingRegistration, 'savedAt'>} data */
export function savePendingRegistration(data) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: Date.now() }))
  } catch {
    /* ignore quota / private mode */
  }
}

/** @returns {PendingRegistration | null} */
export function loadPendingRegistration() {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearPendingRegistration() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function isOnboardingComplete(profile) {
  if (profile?.onboarded_at) return true
  const prefs = profile?.user_preferences
  return !!(prefs && typeof prefs === 'object' && prefs.terms_agreed === true)
}

/** 'google' | 'apple' when the session came from a social provider, else null. */
export function socialProviderOf(authUser) {
  const p = authUser?.app_metadata?.provider
  return p === 'google' || p === 'apple' ? p : null
}
