import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listTables, type UiTable } from '../api/tables'
import { sb } from '../backendClient'
import { queryKeys } from '../lib/queryClient'
import { matchScore as libMatchScore, type AffinityInput, type TasteInput } from '../lib/matchScore'

const EMPTY: UiTable[] = []

export interface UseTablesOptions {
  city?: string | null
  category?: string | null
  tasteProfile?: TasteInput | null
  affinity?: AffinityInput
  /** undefined while auth is still resolving (nothing is fetched yet) */
  userId?: string | null
}

/**
 * Feed tables for a city/category.
 * Supports both:
 *   useTables({ city, category, tasteProfile, affinity })
 *   useTables(city, cat, tasteProfile, affinity)
 */
export function useTables(
  cityOrOpts: string | null | undefined | UseTablesOptions,
  categoryArg?: string | null,
  tasteArg?: TasteInput | null,
  affinityArg?: AffinityInput,
  userIdArg?: string | null,
) {
  const opts: UseTablesOptions =
    cityOrOpts && typeof cityOrOpts === 'object'
      ? cityOrOpts
      : {
          city: cityOrOpts,
          category: categoryArg,
          tasteProfile: tasteArg,
          affinity: affinityArg,
          userId: userIdArg,
        }

  const {
    city,
    category,
    tasteProfile = null,
    affinity = [],
    userId,
  } = opts

  const queryClient = useQueryClient()
  const queryKey = queryKeys.tables(city, category, userId ?? null)
  // userId undefined = auth still resolving: wait, so the feed is fetched once
  // per signed-in user instead of once anonymously and again after login.
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        return await listTables(city, category)
      } catch (err: unknown) {
        console.error('[ejaBashkohu] Gabim gjatë ngarkimit të tavolinave:', err)
        throw err
      }
    },
    enabled: userId !== undefined,
    staleTime: 30_000,
  })
  const rawTables: UiTable[] = query.isError || !query.data ? EMPTY : query.data

  // An explicit refetch (after the user's own join/leave/create) shows the
  // loading state like before; realtime refreshes are silent.
  const [manualLoading, setManualLoading] = useState(false)
  const refetchQuery = query.refetch
  const refetch = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (userId === undefined) return
    if (opts?.silent === true) { await refetchQuery(); return }
    setManualLoading(true)
    try { await refetchQuery() } finally { setManualLoading(false) }
    // city/category: a new feed means a new refetch function, as before
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetchQuery, userId, city, category])

  // Realtime events arrive for the whole platform. Coalesce bursts into one
  // invalidation, and while the app is in the background just remember that the
  // feed is stale and refresh once when the user comes back.
  const liveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stale = useRef(false)
  // Every cached feed (other cities/categories) becomes stale; only the one on
  // screen is refetched now.
  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.allTables })
  }, [queryClient])
  const scheduleRefetch = useCallback((delay = 1200) => {
    if (typeof document !== 'undefined' && document.hidden) { stale.current = true; return }
    clearTimeout(liveTimer.current)
    liveTimer.current = setTimeout(invalidate, delay)
  }, [invalidate])
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden && stale.current) { stale.current = false; invalidate() }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); clearTimeout(liveTimer.current) }
  }, [invalidate])

  useEffect(() => {
    if (!userId) return undefined
    // Only rows of the city on screen. Joins, leaves and request decisions
    // touch their table (tables.activity_at, migration 20261003230000), so this
    // one filtered subscription covers seats changing too.
    const channel = sb
      .channel(`feed-tables:${city ?? 'all'}`)
      .on(
        'postgres_changes',
        city
          ? { event: '*', schema: 'public', table: 'tables', filter: `city=eq.${city}` }
          : { event: '*', schema: 'public', table: 'tables' },
        () => scheduleRefetch(600),
      )
      .subscribe()

    return () => {
      void sb.removeChannel(channel)
    }
  }, [city, scheduleRefetch, userId])

  const tables = useMemo(() => {
    const scored = rawTables.map((table) => ({
      ...table,
      _match: libMatchScore(tasteProfile, table, affinity),
    }))
    scored.sort((a, b) => (b._match ?? 0) - (a._match ?? 0))
    return scored
  }, [rawTables, tasteProfile, affinity])

  return {
    tables,
    /** true until the first answer (and while auth resolves), and during an explicit refetch */
    loading: query.isPending || manualLoading,
    error: query.isError ? query.error : null,
    refetch,
  }
}
