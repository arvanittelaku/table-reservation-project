import { useCallback, useEffect, useState } from 'react'
import { plansApi, isMissingFn } from '../api/plans'

/**
 * The signed-in user's package. Until the plans migration is applied the app
 * behaves as before (everyone unrestricted) instead of breaking.
 */
export function usePlan(userId) {
  const [plan, setPlan] = useState(null)
  const [available, setAvailable] = useState(true)
  const reload = useCallback(async () => {
    if (!userId) { setPlan(null); return null }
    try {
      const p = await plansApi.mine()
      setPlan(p); setAvailable(true)
      return p
    } catch (err) {
      if (isMissingFn(err)) setAvailable(false)
      return null
    }
  }, [userId])
  useEffect(() => { void reload() }, [reload])

  const isPremium = !available || plan?.tier === 'premium'
  const limitReached = !!plan && !isPremium && plan.table_limit != null && plan.tables_this_month >= plan.table_limit
  return { plan, reload, available, isPremium, limitReached }
}
