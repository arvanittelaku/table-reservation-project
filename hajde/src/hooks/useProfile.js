import { useCallback, useEffect, useRef, useState } from 'react'
import { sb } from '../backendClient'
import { fetchOwnProfile } from '../lib/ownProfile'

/**
 * Loads everything the header and match scores need for the logged-in user:
 * profile, completed taste_profile, affinity rows, and badges.
 */
export function useProfile(userId) {
  const [profile, setProfile] = useState(null)
  const [tasteProfile, setTasteProfile] = useState(null)
  const [affinity, setAffinity] = useState([])
  const [badges, setBadges] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // first load may share the startup request; later reloads (after edits) are fresh
  const first = useRef(true)
  const reload = useCallback(async () => {
    if (!userId) {
      setProfile(null)
      setTasteProfile(null)
      setAffinity([])
      setBadges([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [profileRes, tasteRes, affinityRes, badgesRes] = await Promise.all([
        fetchOwnProfile(userId, { fresh: !first.current }),
        sb
          .from('taste_profiles')
          .select('*')
          .eq('user_id', userId)
          .eq('done', true)
          .maybeSingle(),
        sb.from('affinity').select('*').eq('user_id', userId),
        sb.from('badges').select('*').eq('user_id', userId),
      ])

      if (profileRes.error) throw profileRes.error
      if (tasteRes.error) throw tasteRes.error
      if (affinityRes.error) throw affinityRes.error
      if (badgesRes.error) throw badgesRes.error

      first.current = false
      setProfile(profileRes.data)
      setTasteProfile(tasteRes.data)
      setAffinity(affinityRes.data ?? [])
      setBadges(badgesRes.data ?? [])
    } catch (err) {
      setError(err)
      setProfile(null)
      setTasteProfile(null)
      setAffinity([])
      setBadges([])
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setProfile(null)
      setTasteProfile(null)
      setAffinity([])
      setBadges([])
      setError(null)
      setLoading(false)
      return
    }
    reload()
  }, [userId, reload])

  return {
    profile,
    tasteProfile,
    affinity,
    badges,
    loading,
    error,
    reload,
  }
}
