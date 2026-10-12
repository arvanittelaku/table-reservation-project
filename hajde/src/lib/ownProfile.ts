import { sb, type DbResult } from '../backendClient'
import { queryClient } from './queryClient'
import type { ProfileRow } from '../types/db'

/**
 * The signed-in user's full profile row, shared by everyone who needs it at
 * startup (useProfile, post-login routing, onboarding resume, notification
 * prefs). Backed by the query cache: concurrent or near-simultaneous callers
 * (within TTL) share one request. `fresh: true` (after a write) always hits
 * the database.
 */
const TTL = 4000
type ProfileResult = DbResult<ProfileRow | null>

const key = (uid: string) => ['ownProfile', uid] as const

/** Thrown inside the query so failures are not cached; turned back into a DbResult. */
class ProfileFetchError extends Error {
  constructor(readonly result: ProfileResult) { super(result.error?.message || 'profile fetch failed') }
}

export function fetchOwnProfile(uid: string | null | undefined, { fresh = false }: { fresh?: boolean } = {}): Promise<ProfileResult> {
  if (!uid) return Promise.resolve({ data: null, error: null, status: 200 })
  if (fresh) queryClient.removeQueries({ queryKey: key(uid), exact: true })
  return queryClient.fetchQuery({
    queryKey: key(uid),
    queryFn: async (): Promise<ProfileResult> => {
      const res = await sb.from('profiles').select('*').eq('id', uid).maybeSingle()
      if (res.error) throw new ProfileFetchError(res)
      return res
    },
    staleTime: TTL,
    retry: false,
  }).catch((e: unknown) => {
    if (e instanceof ProfileFetchError) return e.result
    throw e // network failure: rejects, as the plain request does
  })
}

export function invalidateOwnProfile() { queryClient.removeQueries({ queryKey: ['ownProfile'] }) }
