/**
 * Startup bundle: one round-trip that returns profile, taste_profile, affinity,
 * badges, and plan. Replaces 5 parallel requests at app startup with 1.
 *
 * Both useProfile and usePlan read from the same TanStack Query cache key, so
 * the data is shared and only a single HTTP request is made regardless of how
 * many consumers exist.
 */
import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { plansApi, isMissingFn, type StartupBundle } from '../api/plans'
import { queryKeys } from '../lib/queryClient'
import type { AffinityRow, BadgeRow, MyPlan, ProfileRow, TasteProfileRow } from '../types/db'

const EMPTY_BUNDLE: StartupBundle = {
  profile: null,
  taste: null,
  affinity: [],
  badges: [],
  plan: {
    tier: 'basic',
    premium_until: null,
    is_admin: null,
    home_city: null,
    home_city_changed_at: null,
    can_change_city_at: null,
    table_limit: null,
    join_limit: null,
    tables_this_month: 0,
    joins_this_month: 0,
    pending_order: null,
    plans: null,
  },
}

export interface UseStartupBundleResult {
  bundle: StartupBundle
  loading: boolean
  error: unknown
  reload: () => Promise<void>
  /** true if the startup_bundle RPC is not available (plans migration not yet applied) */
  plansAvailable: boolean
}

/**
 * Low-level hook; prefer useProfile() and usePlan() for component-level use.
 * This hook is the single source of truth — useProfile and usePlan delegate
 * to the query cache populated by this hook.
 */
export function useStartupBundle(userId: string | null | undefined): UseStartupBundleResult {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.startupBundle(userId ?? ''),
    queryFn: () => plansApi.startupBundle(),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  })

  const bundle = (userId && !query.isError && query.data) ? query.data : EMPTY_BUNDLE
  const plansAvailable = !(query.isError && isMissingFn(query.error))

  const refetchQuery = query.refetch
  const reload = useCallback(async () => {
    if (!userId) return
    // Invalidate the old ownProfile cache too so fetchOwnProfile() re-reads fresh
    queryClient.removeQueries({ queryKey: ['ownProfile'] })
    await refetchQuery()
  }, [userId, refetchQuery, queryClient])

  return { bundle, loading: !!userId && query.isFetching, error: query.isError ? query.error : null, reload, plansAvailable }
}

// ─── Derived hooks (backward-compatible with existing callers) ───────────────

/** Profile, tasteProfile, affinity and badges from the bundle. */
export function useProfile(userId: string | null | undefined) {
  const { bundle, loading, error, reload } = useStartupBundle(userId)
  return {
    profile: bundle.profile as ProfileRow | null,
    tasteProfile: bundle.taste as TasteProfileRow | null,
    affinity: bundle.affinity as AffinityRow[],
    badges: bundle.badges as BadgeRow[],
    loading,
    error,
    reload,
  }
}

/** Plan data from the bundle. */
export function usePlan(userId: string | null | undefined) {
  const { bundle, loading, plansAvailable, reload: reloadBundle } = useStartupBundle(userId)
  const plan: MyPlan | null = userId ? bundle.plan : null
  const available = plansAvailable

  const reload = useCallback(async (): Promise<MyPlan | null> => {
    if (!userId) return null
    await reloadBundle()
    return plan
  }, [userId, reloadBundle, plan])

  const isPremium = !available || plan?.tier === 'premium'
  const limitReached = !!plan && !isPremium && plan.table_limit != null && plan.tables_this_month >= plan.table_limit
  return { plan, reload, available, isPremium, limitReached }
}
