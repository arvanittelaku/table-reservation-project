import { useCallback, useEffect, useState } from 'react'
import * as auth from '../api/auth'

/**
 * Auth state for ejaBashkohu.
 *
 * - No user  → stay on onboarding (`showOnboarding === true`)
 * - Logged in → go straight to the main feed (`showOnboarding === false`)
 * - After signUp with email confirmation → `pendingEmailConfirmation` is set
 */
export function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingEmailConfirmation, setPendingEmailConfirmation] = useState(false)

  useEffect(() => {
    let cancelled = false

    auth.getUser().then((current) => {
      if (!cancelled) {
        setUser(current)
        setPendingEmailConfirmation(!!current && !current.email_confirmed_at && !current.confirmed_at)
        setLoading(false)
      }
    })

    const unsubscribe = auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      const nextUser = session?.user ?? null
      setUser(nextUser)
      if (nextUser?.email_confirmed_at || nextUser?.confirmed_at) {
        setPendingEmailConfirmation(false)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email, password) => {
    // Do NOT clear pendingEmailConfirmation before auth succeeds — a failed
    // login on the "confirm email" screen would otherwise drop the user back
    // into mid-onboarding (e.g. step 4 vendas/turist).
    const session = await auth.signIn(email, password)
    setPendingEmailConfirmation(false)
    setUser(session?.user ?? null)
    return session
  }, [])

  const signUp = useCallback(async (email, password, firstName, lastName, age) => {
    const result = await auth.signUp(email, password, firstName, lastName, age)

    if (result.needsEmailConfirmation) {
      setPendingEmailConfirmation(true)
      setUser(null)
      try {
        await auth.signOut()
      } catch {
        /* session may already be absent */
      }
    } else {
      setPendingEmailConfirmation(false)
      setUser(result.user)
    }

    return result
  }, [])

  const signOut = useCallback(async () => {
    await auth.signOut()
    setUser(null)
    setPendingEmailConfirmation(false)
  }, [])

  const clearPendingEmailConfirmation = useCallback(() => {
    setPendingEmailConfirmation(false)
  }, [])

  const showOnboarding = !loading && !user
  const showFeed = !loading && !!user

  return {
    user,
    loading,
    pendingEmailConfirmation,
    showOnboarding,
    showFeed,
    signIn,
    signUp,
    signOut,
    clearPendingEmailConfirmation,
  }
}
