import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listTables } from '../api/tables'
import { sb } from '../backendClient'
import { matchScore as libMatchScore } from '../lib/matchScore'

/**
 * Feed tables for a city/category.
 * Supports both:
 *   useTables({ city, category, tasteProfile, affinity })
 *   useTables(city, cat, tasteProfile, affinity)
 */
export function useTables(cityOrOpts, categoryArg, tasteArg, affinityArg, userIdArg) {
  const opts =
    cityOrOpts && typeof cityOrOpts === 'object' && !Array.isArray(cityOrOpts)
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

  const [rawTables, setRawTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fetchGen = useRef(0)
  const liveTimer = useRef(null)

  const refetch = useCallback(async (opts = {}) => {
    const silent = opts?.silent === true
    const gen = ++fetchGen.current

    if (!silent) {
      setLoading(true)
      setError(null)
    }

    try {
      const rows = await listTables(city, category)
      if (gen !== fetchGen.current) return
      setRawTables(rows)
      setError(null)
    } catch (err) {
      if (gen !== fetchGen.current) return
      console.error('[ejaBashkohu] Gabim gjatë ngarkimit të tavolinave:', err)
      setError(err)
      setRawTables([])
    } finally {
      if (gen === fetchGen.current) setLoading(false)
    }
  }, [city, category])

  // userId undefined = auth still resolving: wait, so the feed is fetched once
  // per signed-in user instead of once anonymously and again after login.
  useEffect(() => {
    if (userId === undefined) return
    void refetch()
  }, [refetch, userId])

  // Realtime events arrive for the whole platform. Coalesce bursts into one
  // refetch, and while the app is in the background just remember that the
  // feed is stale and refresh once when the user comes back.
  const stale = useRef(false)
  const scheduleRefetch = useCallback((delay = 1200) => {
    if (typeof document !== 'undefined' && document.hidden) { stale.current = true; return }
    clearTimeout(liveTimer.current)
    liveTimer.current = setTimeout(() => { void refetch({ silent: true }) }, delay)
  }, [refetch])
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden && stale.current) { stale.current = false; void refetch({ silent: true }) }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); clearTimeout(liveTimer.current) }
  }, [refetch])

  useEffect(() => {
    if (!userId) return undefined
    // Only rows of the city on screen. Joins, leaves and request decisions
    // touch their table (tables.activity_at, migration 20261003230000), so this
    // one filtered subscription covers seats changing too. Previously every app
    // listened to every membership/request change on the whole platform.
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
      sb.removeChannel(channel)
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
    loading,
    error,
    refetch,
  }
}
