import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { sb } from '../backendClient'
import { fetchOwnProfile, invalidateOwnProfile } from '../lib/ownProfile'
import { queryKeys } from '../lib/queryClient'
import type { AffinityRow, BadgeRow, ProfileRow, TasteProfileRow } from '../types/db'

export interface ProfileBundle {
  profile: ProfileRow | null
  tasteProfile: TasteProfileRow | null
  affinity: AffinityRow[]
  badges: BadgeRow[]
}

async function loadProfileBundle(userId: string): Promise<ProfileBundle> {
  const [profileRes, tasteRes, affinityRes, badgesRes] = await Promise.all([
    // shares the startup request with the other profile readers (lib/ownProfile)
    fetchOwnProfile(userId),
    sb.from('taste_profiles').select('*').eq('user_id', userId).eq('done', true).maybeSingle(),
    sb.from('affinity').select('*').eq('user_id', userId),
    sb.from('badges').select('*').eq('user_id', userId),
  ])
  if (profileRes.error) throw profileRes.error
  if (tasteRes.error) throw tasteRes.error
  if (affinityRes.error) throw affinityRes.error
  if (badgesRes.error) throw badgesRes.error
  return {
    profile: profileRes.data,
    tasteProfile: tasteRes.data,
    affinity: affinityRes.data ?? [],
    badges: badgesRes.data ?? [],
  }
}

const EMPTY: ProfileBundle = { profile: null, tasteProfile: null, affinity: [], badges: [] }

/**
 * Loads everything the header and match scores need for the logged-in user:
 * profile, completed taste_profile, affinity rows, and badges.
 */
export function useProfile(userId: string | null | undefined) {
  const query = useQuery({
    queryKey: queryKeys.profile(userId ?? ''),
    queryFn: () => loadProfileBundle(userId as string),
    enabled: !!userId,
    // changes only through the user's own edits, which call reload()
    staleTime: 5 * 60_000,
  })
  const data = userId && !query.isError && query.data ? query.data : EMPTY

  const refetchQuery = query.refetch
  // reloads after an edit read the profile row fresh, not from the shared startup request
  const reload = useCallback(async () => {
    if (!userId) return
    invalidateOwnProfile()
    await refetchQuery()
  }, [userId, refetchQuery])

  return {
    profile: data.profile,
    tasteProfile: data.tasteProfile,
    affinity: data.affinity,
    badges: data.badges,
    loading: !!userId && query.isFetching,
    error: userId && query.isError ? query.error : null,
    reload,
  }
}
