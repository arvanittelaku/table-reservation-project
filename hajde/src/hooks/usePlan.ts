import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { plansApi, isMissingFn } from '../api/plans'
import { queryKeys } from '../lib/queryClient'
import type { MyPlan } from '../types/db'

/**
 * The signed-in user's package. Until the plans migration is applied the app
 * behaves as before (everyone unrestricted) instead of breaking.
 */
export function usePlan(userId: string | null | undefined) {
  const query = useQuery({
    queryKey: queryKeys.plan(userId ?? ''),
    queryFn: () => plansApi.mine(),
    enabled: !!userId,
    // counters change only through the user's own actions, which call reload()
    staleTime: 5 * 60_000,
  })
  const plan: MyPlan | null = (userId && query.data) || null
  const available = !(query.isError && isMissingFn(query.error))

  const refetchQuery = query.refetch
  const reload = useCallback(async (): Promise<MyPlan | null> => {
    if (!userId) return null
    const r = await refetchQuery()
    return r.isError ? null : (r.data ?? null)
  }, [userId, refetchQuery])

  const isPremium = !available || plan?.tier === 'premium'
  const limitReached = !!plan && !isPremium && plan.table_limit != null && plan.tables_this_month >= plan.table_limit
  return { plan, reload, available, isPremium, limitReached }
}
