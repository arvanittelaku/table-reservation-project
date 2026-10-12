const KEY = 'ejabashkohu-pending-registration'

import type { AuthUser } from '../backendClient'
import type { ProfileRow } from '../types/db'

export interface PendingRegistration { userId: string; email: string; firstName: string; lastName: string; age: string; savedAt?: number }

export function savePendingRegistration(data: Omit<PendingRegistration, 'savedAt'>) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: Date.now() }))
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadPendingRegistration(): PendingRegistration | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as PendingRegistration) : null
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

export function isOnboardingComplete(profile: Pick<ProfileRow, 'onboarded_at' | 'user_preferences'> | null | undefined): boolean {
  if (profile?.onboarded_at) return true
  const prefs = profile?.user_preferences
  return !!(prefs && typeof prefs === 'object' && prefs.terms_agreed === true)
}

/** 'google' | 'apple' when the session came from a social provider, else null. */
export function socialProviderOf(authUser: AuthUser | null | undefined): 'google' | 'apple' | null {
  const p = authUser?.app_metadata?.provider
  return p === 'google' || p === 'apple' ? p : null
}
